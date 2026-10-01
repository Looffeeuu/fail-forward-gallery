import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '../server/database.mjs';
import {
  countStoryUnits,
  createStoryService
} from '../server/story-service.mjs';

test('story counting combines Latin words and CJK characters', () => {
  assert.deepEqual(countStoryUnits('two words 失败经历'), {
    englishWords: 2,
    cjkCharacters: 4,
    total: 6
  });
});

test('a story is owned privately and starts pending human review', (t) => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const firstAccount = database.findOrCreateAccount('phone-fingerprint-one');
  const secondAccount = database.findOrCreateAccount('phone-fingerprint-two');
  const storyService = createStoryService({
    database,
    now: () => new Date('2026-09-15T08:00:00.000Z'),
    generateId: () => 'story-one'
  });

  const story = storyService.createStory({
    accountId: firstAccount.id,
    input: {
      title: '一次没有结果的尝试',
      board: 'academic',
      content: '失败'.repeat(75),
      responsePreference: 'similar',
      tags: ['ExamFailure', 'FamilyPressure'],
      guidelinesAccepted: true
    }
  });

  assert.equal(story.id, 'story-one');
  assert.equal(story.moderationStatus, 'pending-human-review');
  assert.equal(story.automatedReviewStatus, 'not-configured');
  assert.equal(story.humanReviewStatus, 'pending');
  assert.equal(story.visibility, 'anonymous-public');
  assert.deepEqual(story.tags, ['ExamFailure', 'FamilyPressure']);
  assert.equal('authorAccountId' in story, false);
  assert.equal(storyService.listMyStories(firstAccount.id).length, 1);
  assert.deepEqual(storyService.listMyStories(secondAccount.id), []);
});

test('story validation rejects invalid length and tag input', (t) => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const account = database.findOrCreateAccount('phone-fingerprint');
  const storyService = createStoryService({ database });
  const baseInput = {
    title: 'A private draft',
    board: 'job',
    content: '失'.repeat(150),
    responsePreference: 'none',
    tags: [],
    guidelinesAccepted: true
  };

  assert.throws(
    () => storyService.createStory({
      accountId: account.id,
      input: { ...baseInput, content: '失'.repeat(149) }
    }),
    (error) => error.code === 'invalid-story-length'
  );
  assert.throws(
    () => storyService.createStory({
      accountId: account.id,
      input: { ...baseInput, tags: ['not a stable tag'] }
    }),
    (error) => error.code === 'invalid-tags'
  );
});
