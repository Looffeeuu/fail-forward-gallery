import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthorControlService } from '../server/author-control-service.mjs';
import { createDatabase } from '../server/database.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createNotificationService } from '../server/notification-service.mjs';
import { createReportService } from '../server/report-service.mjs';
import { createStoryResponseService } from '../server/story-response-service.mjs';
import { createStoryService } from '../server/story-service.mjs';

function createFixture(t, reportLimits) {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  let idCounter = 0;
  const generateId = () => `report-${String(idCounter += 1).padStart(3, '0')}`;
  let currentTime = new Date('2026-10-19T02:00:00.000Z').getTime();
  const now = () => new Date(currentTime += 1000);
  const accounts = Object.fromEntries(['author', 'reader', 'bystander'].map((name) => [
    name,
    database.findOrCreateAccount(`${name}-phone`)
  ]));
  const moderator = database.findOrCreateAccount('moderator-phone', new Date(), 'moderator');
  const session = { accountId: moderator.id, role: 'moderator', status: 'active' };
  const services = {
    stories: createStoryService({ database, now, generateId }),
    responses: createStoryResponseService({ database, now, generateId }),
    control: createAuthorControlService({ database, now, generateId }),
    moderation: createModerationService({ database, now }),
    notifications: createNotificationService({ database, now }),
    reports: createReportService({ database, now, generateId, ...(reportLimits ? { reportLimits } : {}) })
  };
  const reason = 'Recorded for the people involved.';

  function publishStory(accountId = accounts.author.id) {
    const story = services.stories.createStory({
      accountId,
      input: {
        title: 'Reported story',
        board: 'social',
        content: '失'.repeat(150),
        responsePreference: 'encouragement',
        tags: [],
        guidelinesAccepted: true
      }
    });
    services.moderation.decideStory({ session, storyId: story.id, input: { decision: 'approve', reason } });
    return story;
  }

  function report(accountId, contentType, contentId, input = { reasonCode: 'harassment' }) {
    return services.reports.createReport({ accountId, contentType, contentId, input });
  }

  return { database, accounts, session, services, reason, publishStory, report };
}

test('reports are limited to other people\'s public content, once each', (t) => {
  const { accounts, services, report, publishStory } = createFixture(t, {
    windowMs: 60 * 60 * 1000,
    maxPerWindow: 2
  });
  const pending = services.stories.createStory({
    accountId: accounts.author.id,
    input: {
      title: 'Pending',
      board: 'social',
      content: '失'.repeat(150),
      responsePreference: 'none',
      tags: [],
      guidelinesAccepted: true
    }
  });
  assert.throws(() => report(accounts.reader.id, 'story', pending.id), { code: 'content-not-found', status: 404 });

  const story = publishStory();
  assert.throws(() => report(null, 'story', story.id), { code: 'authentication-required' });
  assert.throws(() => report(accounts.author.id, 'story', story.id), { code: 'cannot-report-own-content' });
  assert.throws(
    () => report(accounts.reader.id, 'story', story.id, { reasonCode: 'boring' }),
    { code: 'invalid-report-reason' }
  );
  assert.throws(
    () => report(accounts.reader.id, 'story', story.id, { reasonCode: 'other' }),
    { code: 'invalid-report-details' }
  );

  assert.equal(report(accounts.reader.id, 'story', story.id).status, 'open');
  assert.throws(() => report(accounts.reader.id, 'story', story.id), { code: 'already-reported', status: 409 });
  report(accounts.reader.id, 'story', publishStory().id);
  assert.throws(
    () => report(accounts.reader.id, 'story', publishStory().id),
    (error) => error.code === 'report-rate-limited' && error.status === 429 && error.retryAfterSeconds > 0
  );
});

test('reviewers remove or keep reported content and everyone involved is told', (t) => {
  const { database, accounts, session, services, reason, publishStory, report } = createFixture(t);
  const story = publishStory();
  const comment = services.responses.createComment({
    accountId: accounts.reader.id,
    storyId: story.id,
    input: { content: 'You should have tried harder.' }
  });
  // An earlier rejection was appealed and overturned before the comment was reported.
  services.moderation.decideComment({ session, commentId: comment.id, input: { decision: 'reject', reason } });
  services.control.appeal({
    accountId: accounts.reader.id,
    contentType: 'comment',
    contentId: comment.id,
    input: { reasonCode: 'within-guidelines', explanation: 'It was meant as encouragement.' }
  });
  const [appeal] = services.moderation.listPendingAppeals(session);
  services.moderation.decideAppeal({ session, appealId: appeal.id, input: { decision: 'overturn', reason } });

  report(accounts.author.id, 'comment', comment.id, { reasonCode: 'outside-boundary' });
  report(accounts.bystander.id, 'story', story.id, { reasonCode: 'spam' });
  report(accounts.bystander.id, 'comment', comment.id, {
    reasonCode: 'safety-concern',
    details: 'This could push the author further down.'
  });

  const queue = services.moderation.listReportedContent(session);
  assert.deepEqual(queue.map(({ contentType, reportCount }) => [contentType, reportCount]), [
    ['comment', 2],
    ['story', 1]
  ]);
  assert.equal(queue[0].hasSafetyConcern, true);
  assert.equal(queue[0].content.content, 'You should have tried harder.');
  assert.deepEqual(Object.keys(queue[0].reports[0]).sort(), ['createdAt', 'details', 'reasonCode']);

  services.moderation.decideReports({
    session,
    contentType: 'comment',
    contentId: comment.id,
    input: { decision: 'remove', reason: 'This response goes beyond encouragement.' }
  });
  assert.equal(services.stories.listPublishedStories()[0].comments.length, 0);
  const ownComment = services.responses.listMyComments(accounts.reader.id)[0];
  assert.equal(ownComment.moderationStatus, 'rejected');
  assert.equal(ownComment.decisionReason, 'This response goes beyond encouragement.');
  assert.equal(ownComment.appealStatus, null, 'the earlier appeal belongs to an older decision');
  assert.equal(
    services.control.appeal({
      accountId: accounts.reader.id,
      contentType: 'comment',
      contentId: comment.id,
      input: { reasonCode: 'context-misunderstood', explanation: 'I wanted to motivate them.' }
    }).appealStatus,
    'pending'
  );
  assert.deepEqual(
    database.listModerationEvents(comment.id, 'comment').map(({ action }) => action),
    ['submitted', 'rejected', 'appealed', 'appeal-overturned', 'removed', 'appealed']
  );

  services.moderation.decideReports({
    session,
    contentType: 'story',
    contentId: story.id,
    input: { decision: 'dismiss', reason: 'No advertising was found.' }
  });
  assert.equal(services.stories.listPublishedStories().length, 1);
  assert.equal(services.moderation.listReportedContent(session).length, 0);
  assert.throws(
    () => services.moderation.decideReports({
      session,
      contentType: 'story',
      contentId: story.id,
      input: { decision: 'remove', reason: 'Already handled earlier.' }
    }),
    { code: 'review-conflict', status: 409 }
  );

  const kinds = (account) => services.notifications.list(account.id).notifications.map(({ kind }) => kind);
  assert.ok(kinds(accounts.reader).includes('removed'));
  assert.ok(kinds(accounts.author).includes('report-actioned'));
  assert.deepEqual(
    kinds(accounts.bystander).sort(),
    ['report-actioned', 'report-dismissed']
  );
});

test('reports on withdrawn content leave the review queue', (t) => {
  const { accounts, session, services, publishStory, report } = createFixture(t);
  const story = publishStory();
  report(accounts.reader.id, 'story', story.id);
  services.control.withdraw({ accountId: accounts.author.id, contentType: 'story', contentId: story.id });
  assert.equal(services.moderation.listReportedContent(session).length, 0);
});
