import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthorControlService } from '../server/author-control-service.mjs';
import { createDatabase } from '../server/database.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createNotificationService } from '../server/notification-service.mjs';
import { createReportService } from '../server/report-service.mjs';
import { detectRiskSignals } from '../server/risk-signals.mjs';
import { createStoryResponseService } from '../server/story-response-service.mjs';
import { createStoryService } from '../server/story-service.mjs';

// Story bodies must hold 150-200 counted characters; the filler keeps them valid.
const FLAGGED = `有时候真的觉得活不下去了。${'难'.repeat(150)}`;
const ORDINARY = `我在慢慢想办法补救，也和导师谈过了。${'难'.repeat(150)}`;

function createFixture(t) {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  let idCounter = 0;
  const generateId = () => `safety-${String(idCounter += 1).padStart(3, '0')}`;
  let time = new Date('2026-10-20T01:00:00.000Z').getTime();
  const now = () => new Date(time += 1000);
  const author = database.findOrCreateAccount('author-phone');
  const reader = database.findOrCreateAccount('reader-phone');
  const moderator = database.findOrCreateAccount('moderator-phone', new Date(), 'moderator');
  const session = { accountId: moderator.id, role: 'moderator', status: 'active' };
  const services = {
    stories: createStoryService({ database, now, generateId }),
    responses: createStoryResponseService({ database, now, generateId }),
    control: createAuthorControlService({ database, now, generateId }),
    moderation: createModerationService({ database, now, generateId }),
    notifications: createNotificationService({ database, now }),
    reports: createReportService({ database, now, generateId })
  };
  const submit = (content) => services.stories.createStory({
    accountId: author.id,
    input: { title: 'Three failed courses', board: 'academic', content, responsePreference: 'encouragement', tags: [], guidelinesAccepted: true }
  });
  const decideStory = (storyId, decision) => services.moderation.decideStory({
    session, storyId, input: { decision, reason: 'Internal note for the review team.' }
  });
  return { database, author, reader, session, services, submit, decideStory };
}

test('risk signals cover self-harm and harm to others in Chinese and English', () => {
  assert.deepEqual(detectRiskSignals('有时候真的觉得活不下去了'), ['self-harm']);
  assert.deepEqual(detectRiskSignals('I keep thinking I want to die'), ['self-harm']);
  assert.deepEqual(detectRiskSignals('我真想报复社会'), ['harm-to-others']);
  assert.deepEqual(detectRiskSignals('Title', '挂科之后我很难过，但还在努力'), []);
});

test('flagged writing is prioritised for reviewers and offered care, never auto-decided', (t) => {
  const { author, session, services, submit } = createFixture(t);
  const flagged = submit(FLAGGED);
  const ordinary = submit(ORDINARY);

  assert.equal(flagged.moderationStatus, 'pending-human-review', 'a signal never decides by itself');
  assert.equal(flagged.careSuggested, true);
  assert.equal('riskSignal' in flagged, false, 'authors are not shown a risk label');
  assert.equal(ordinary.careSuggested, false);

  const queue = services.moderation.listPendingStories(session);
  assert.equal(queue.find(({ id }) => id === flagged.id).riskSignal, 'self-harm');
  assert.equal(queue.find(({ id }) => id === ordinary.id).riskSignal, null);

  const privateUpdate = services.responses.createFollowUp({
    accountId: author.id,
    storyId: (() => {
      services.moderation.decideStory({ session, storyId: ordinary.id, input: { decision: 'approve', reason: 'Fine to publish.' } });
      return ordinary.id;
    })(),
    input: { status: 'still-difficult', content: 'Some nights I want to die.', visibility: 'private' }
  });
  assert.equal(privateUpdate.careSuggested, true, 'private updates still offer care');
  assert.equal(services.moderation.listPendingFollowUps(session).length, 0, 'and stay private');
});

test('a safety hold keeps content private with care, then can be released', (t) => {
  const { database, author, session, services, submit, decideStory } = createFixture(t);
  const story = submit(FLAGGED);
  decideStory(story.id, 'safety-hold');

  const [owned] = services.stories.listMyStories(author.id);
  assert.equal(owned.moderationStatus, 'safety-hold');
  assert.equal(owned.decisionReason, null, 'internal notes stay with reviewers');
  assert.equal(owned.careSuggested, true);
  assert.equal(services.stories.listPublishedStories().length, 0);
  assert.equal(services.notifications.list(author.id).notifications[0].kind, 'safety-hold');
  assert.throws(
    () => services.control.appeal({
      accountId: author.id,
      contentType: 'story',
      contentId: story.id,
      input: { reasonCode: 'other', explanation: 'Please publish my story.' }
    }),
    { code: 'appeal-not-available' },
    'a hold is not a rejection, so there is nothing to appeal'
  );

  const [held] = services.moderation.listHeldContent(session);
  assert.equal(held.contentType, 'story');
  assert.equal(held.content.decisionReason, 'Internal note for the review team.');
  assert.throws(() => decideStory(story.id, 'approve'), { code: 'review-conflict' });

  services.moderation.decideHeld({
    session,
    contentType: 'story',
    contentId: story.id,
    input: { decision: 'release', reason: 'Checked in with the author; safe to publish.' }
  });
  assert.equal(services.stories.listPublishedStories().length, 1);
  assert.equal(services.moderation.listHeldContent(session).length, 0);
  assert.deepEqual(
    database.listModerationEvents(story.id).map(({ action }) => action),
    ['submitted', 'safety-held', 'safety-released']
  );
});

test('held content can instead become an appealable rejection', (t) => {
  const { reader, session, services, submit, decideStory } = createFixture(t);
  const story = submit(ORDINARY);
  decideStory(story.id, 'approve');
  const comment = services.responses.createComment({
    accountId: reader.id,
    storyId: story.id,
    input: { content: 'Honestly I want to die some days too.' }
  });
  services.moderation.decideComment({
    session, commentId: comment.id, input: { decision: 'safety-hold', reason: 'Reader may be at risk.' }
  });
  services.moderation.decideHeld({
    session,
    contentType: 'comment',
    contentId: comment.id,
    input: { decision: 'reject', reason: 'This response is about the reader, not the author.' }
  });
  const [owned] = services.responses.listMyComments(reader.id);
  assert.equal(owned.moderationStatus, 'rejected');
  assert.equal(owned.decisionReason, 'This response is about the reader, not the author.');
  assert.equal(
    services.control.appeal({
      accountId: reader.id,
      contentType: 'comment',
      contentId: comment.id,
      input: { reasonCode: 'context-misunderstood', explanation: 'I wanted to show solidarity.' }
    }).appealStatus,
    'pending'
  );
});

test('a safety-concern report can hold published content for care', (t) => {
  const { author, reader, session, services, submit, decideStory } = createFixture(t);
  const story = submit(ORDINARY);
  decideStory(story.id, 'approve');
  services.reports.createReport({
    accountId: reader.id,
    contentType: 'story',
    contentId: story.id,
    input: { reasonCode: 'safety-concern', details: 'The author sounds very low.' }
  });
  const result = services.moderation.decideReports({
    session,
    contentType: 'story',
    contentId: story.id,
    input: { decision: 'safety-hold', reason: 'Following up with the author first.' }
  });
  assert.equal(result.status, 'safety-hold');
  assert.equal(services.stories.listPublishedStories().length, 0);
  assert.equal(services.moderation.listHeldContent(session).length, 1);
  assert.equal(services.notifications.list(author.id).notifications[0].kind, 'safety-hold');
  assert.equal(services.notifications.list(reader.id).notifications[0].kind, 'report-actioned');
});
