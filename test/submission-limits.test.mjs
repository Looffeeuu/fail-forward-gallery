import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '../server/database.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createStoryResponseService } from '../server/story-response-service.mjs';
import { createStoryService } from '../server/story-service.mjs';

const HOUR = 60 * 60 * 1000;

function createFixture(t) {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  let idCounter = 0;
  const generateId = () => `limit-${String(idCounter += 1).padStart(3, '0')}`;
  const clock = { time: new Date('2026-10-20T08:00:00.000Z').getTime() };
  const now = () => new Date(clock.time);
  const writer = database.findOrCreateAccount('writer-phone');
  const moderator = database.findOrCreateAccount('moderator-phone', new Date(), 'moderator');
  const session = { accountId: moderator.id, role: 'moderator', status: 'active' };
  const stories = createStoryService({ database, now, generateId });
  const responses = createStoryResponseService({ database, now, generateId });
  const moderation = createModerationService({ database, now });
  const submit = () => stories.createStory({
    accountId: writer.id,
    input: { title: 'One more', board: 'job', content: '失'.repeat(150), responsePreference: 'none', tags: [], guidelinesAccepted: true }
  });
  const approve = (storyId) => moderation.decideStory({
    session, storyId, input: { decision: 'approve', reason: 'Fine to publish.' }
  });
  return { clock, writer, responses, submit, approve };
}

test('stories are limited per hour and by how many await review', (t) => {
  const { clock, submit, approve } = createFixture(t);
  const first = submit();
  clock.time += 10 * 60 * 1000;
  submit();
  submit();
  assert.throws(
    submit,
    (error) => error.code === 'story-rate-limited' && error.status === 429 && error.retryAfterSeconds === 50 * 60
  );

  clock.time += HOUR;
  assert.throws(submit, { code: 'too-many-pending-stories', status: 429 });
  approve(first.id);
  assert.equal(submit().moderationStatus, 'pending-human-review', 'a decision frees a slot');
});

test('follow-ups are limited too, and private ones count towards the hourly limit', (t) => {
  const { clock, writer, responses, submit, approve } = createFixture(t);
  const story = submit();
  approve(story.id);
  const addFollowUp = (visibility) => responses.createFollowUp({
    accountId: writer.id,
    storyId: story.id,
    input: { status: 'no-major-change', visibility }
  });

  addFollowUp('private');
  addFollowUp('anonymous-public');
  addFollowUp('anonymous-public');
  assert.throws(() => addFollowUp('private'), { code: 'follow-up-rate-limited', status: 429 });

  clock.time += HOUR;
  addFollowUp('anonymous-public');
  assert.throws(() => addFollowUp('anonymous-public'), { code: 'too-many-pending-follow-ups', status: 429 });
});
