import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '../server/database.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createStoryService } from '../server/story-service.mjs';

function createStory(storyService, accountId, title) {
  return storyService.createStory({
    accountId,
    input: {
      title,
      board: 'academic',
      content: '失'.repeat(150),
      responsePreference: 'none',
      tags: ['ExamFailure'],
      guidelinesAccepted: true
    }
  });
}

test('only reviewers can decide stories and every decision is audited', (t) => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const author = database.findOrCreateAccount('author-phone');
  const member = database.findOrCreateAccount('member-phone');
  const moderator = database.findOrCreateAccount(
    'moderator-phone',
    new Date('2026-09-16T00:00:00.000Z'),
    'moderator'
  );
  let storyCounter = 0;
  const storyService = createStoryService({
    database,
    now: () => new Date('2026-09-16T00:30:00.000Z'),
    generateId: () => `moderation-story-${storyCounter += 1}`
  });
  const moderationService = createModerationService({
    database,
    now: () => new Date('2026-09-16T01:00:00.000Z')
  });

  const rejectedStory = createStory(storyService, author.id, 'A rejected story');
  const approvedStory = createStory(storyService, author.id, 'An approved story');

  assert.throws(
    () => moderationService.listPendingStories({
      accountId: member.id,
      role: 'member',
      status: 'active'
    }),
    (error) => error.code === 'moderator-required'
  );

  const reviewerSession = {
    accountId: moderator.id,
    role: 'moderator',
    status: 'active'
  };
  assert.equal(moderationService.listPendingStories(reviewerSession).length, 2);

  const rejected = moderationService.decideStory({
    session: reviewerSession,
    storyId: rejectedStory.id,
    input: {
      decision: 'reject',
      reason: 'Contains identifying details that must be removed.'
    }
  });
  assert.equal(rejected.moderationStatus, 'rejected');
  assert.equal(rejected.humanReviewStatus, 'rejected');
  assert.match(rejected.decisionReason, /identifying details/);

  assert.throws(
    () => moderationService.decideStory({
      session: reviewerSession,
      storyId: rejectedStory.id,
      input: { decision: 'approve', reason: 'A second decision is not allowed.' }
    }),
    (error) => error.code === 'review-conflict'
  );

  const approved = moderationService.decideStory({
    session: reviewerSession,
    storyId: approvedStory.id,
    input: {
      decision: 'approve',
      reason: 'Meets the privacy and community guidelines.'
    }
  });
  assert.equal(approved.moderationStatus, 'approved');
  assert.equal(approved.publishedAt, '2026-09-16T01:00:00.000Z');

  const published = storyService.listPublishedStories();
  assert.equal(published.length, 1);
  assert.equal(published[0].id, approvedStory.id);
  assert.equal('decisionReason' in published[0], false);
  assert.equal('authorAccountId' in published[0], false);

  assert.deepEqual(
    database.listModerationEvents(rejectedStory.id).map(({ action }) => action),
    ['submitted', 'rejected']
  );
  assert.deepEqual(
    database.listModerationEvents(approvedStory.id).map(({ action }) => action),
    ['submitted', 'approved']
  );
});
