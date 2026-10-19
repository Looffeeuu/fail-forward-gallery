import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthorControlService } from '../server/author-control-service.mjs';
import { createDatabase } from '../server/database.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createRankingService } from '../server/ranking-service.mjs';
import { createStoryResponseService } from '../server/story-response-service.mjs';
import { createStoryService } from '../server/story-service.mjs';
import { createViewService } from '../server/view-service.mjs';

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36';
const HOUR = 60 * 60 * 1000;

function createFixture(t, viewLimits) {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  let idCounter = 0;
  const generateId = () => `rank-${String(idCounter += 1).padStart(3, '0')}`;
  const clock = { time: new Date('2026-10-19T12:00:00.000Z').getTime() };
  const now = () => new Date(clock.time);
  const author = database.findOrCreateAccount('author-phone');
  const reader = database.findOrCreateAccount('reader-phone');
  const moderator = database.findOrCreateAccount('moderator-phone', new Date(), 'moderator');
  const session = { accountId: moderator.id, role: 'moderator', status: 'active' };
  const stories = createStoryService({ database, now, generateId });
  const responses = createStoryResponseService({ database, now, generateId });
  const moderation = createModerationService({ database, now, generateId });
  const control = createAuthorControlService({ database, now, generateId });
  const views = createViewService({
    database,
    secret: 'ranking-test-secret',
    now,
    ...(viewLimits ? { viewLimits } : {})
  });
  const rankings = createRankingService({ database, storyService: stories, now });
  const reason = 'Meets the community guidelines.';

  function publish(title, responsePreference = 'encouragement') {
    const story = stories.createStory({
      accountId: author.id,
      input: { title, board: 'job', content: '失'.repeat(150), responsePreference, tags: [], guidelinesAccepted: true }
    });
    moderation.decideStory({ session, storyId: story.id, input: { decision: 'approve', reason } });
    return story;
  }

  function view(storyId, visitorId, extra = {}) {
    return views.recordView({
      storyId,
      visitorId,
      accountId: null,
      userAgent: BROWSER,
      sourceAddress: `10.0.0.${String(visitorId).length}`,
      ...extra
    });
  }

  function comment(storyId, content) {
    const created = responses.createComment({ accountId: reader.id, storyId, input: { content } });
    moderation.decideComment({ session, commentId: created.id, input: { decision: 'approve', reason } });
  }

  return { database, clock, author, session, stories, moderation, control, rankings, publish, view, comment };
}

test('each person counts once per story per day, never for their own story', (t) => {
  const { clock, author, stories, publish, view } = createFixture(t);
  const story = publish('Counted');

  assert.equal(view(story.id, 'visitor-aaaaaaaaaaaa'), true);
  assert.equal(view(story.id, 'visitor-aaaaaaaaaaaa'), false, 'same visitor, same day');
  assert.equal(view(story.id, 'visitor-bbbbbbbbbbbb', { userAgent: 'Googlebot/2.1' }), false);
  assert.equal(view(story.id, null, { accountId: author.id }), false, 'authors do not inflate their own story');
  assert.equal(view(story.id, null), false, 'no viewer identity at all');
  assert.throws(() => view('missing-story', 'visitor-cccccccccccc'), { code: 'story-not-found', status: 404 });

  clock.time += 24 * HOUR;
  assert.equal(view(story.id, 'visitor-aaaaaaaaaaaa'), true, 'a new day counts again');

  const [owned] = stories.listMyStories(author.id);
  assert.deepEqual(owned.stats, { totalViews: 2, weekViews: 2, approvedComments: 0 });
});

test('one network source cannot add unlimited new views', (t) => {
  const { publish, view } = createFixture(t, { windowMs: HOUR, maxNewViewsPerSource: 2 });
  const story = publish('Guarded');
  const sameSource = { sourceAddress: '203.0.113.9' };
  assert.equal(view(story.id, 'visitor-one-xxxxxxxx', sameSource), true);
  assert.equal(view(story.id, 'visitor-two-xxxxxxxx', sameSource), true);
  assert.equal(view(story.id, 'visitor-three-xxxxxx', sameSource), false);
  assert.equal(view(story.id, 'visitor-four-xxxxxxx', { sourceAddress: '198.51.100.4' }), true);
});

test('rankings order public stories without exposing figures', (t) => {
  const { clock, author, session, moderation, control, rankings, publish, view, comment } = createFixture(t);
  const busy = publish('Busy');
  const discussed = publish('Discussed');
  const older = publish('Older', 'none');

  // "Older" was read three days ago: inside the 7-day window only.
  clock.time -= 72 * HOUR;
  view(older.id, 'visitor-older-one-xx');
  view(older.id, 'visitor-older-two-xx');
  clock.time += 72 * HOUR;
  ['visitor-busy-one-xxx', 'visitor-busy-two-xxx', 'visitor-busy-three-x'].forEach((visitor) => {
    view(busy.id, visitor);
  });
  view(discussed.id, 'visitor-disc-one-xxx');
  comment(discussed.id, 'This happened to me too.');
  comment(discussed.id, 'You are not alone in this.');
  comment(busy.id, 'Thank you for writing this.');

  const result = rankings.getRankings();
  assert.deepEqual(result.rankings.mostReadDay, [busy.id, discussed.id]);
  assert.deepEqual(result.rankings.mostReadWeek, [busy.id, older.id, discussed.id]);
  assert.deepEqual(result.rankings.mostDiscussed, [discussed.id, busy.id]);
  // Responses weigh more than views: 1 view + 2 responses beats 3 views + 1 response.
  assert.deepEqual(result.rankings.trending.slice(0, 2), [discussed.id, busy.id]);
  assert.equal(result.stories.length, 3);
  assert.equal(/count|views|score/i.test(JSON.stringify(result.rankings)), false);
  assert.equal('totalViews' in result.stories[0], false);

  moderation.recommendStory({ session, storyId: older.id, input: { reason: 'A quiet story worth reading.' } });
  assert.throws(
    () => moderation.recommendStory({ session, storyId: older.id, input: { reason: 'short' } }),
    { code: 'invalid-recommendation-reason' }
  );
  // Cached for a minute, so new activity appears on the next refresh.
  assert.deepEqual(rankings.getRankings().rankings.recommended, []);
  clock.time += 61 * 1000;
  assert.deepEqual(rankings.getRankings().rankings.recommended, [
    { storyId: older.id, reason: 'A quiet story worth reading.' }
  ]);

  control.withdraw({ accountId: author.id, contentType: 'story', contentId: busy.id });
  moderation.unrecommendStory({ session, storyId: older.id });
  rankings.invalidate();
  const afterChanges = rankings.getRankings().rankings;
  assert.equal(Object.values(afterChanges).flat().includes(busy.id), false, 'withdrawn stories leave every list');
  assert.deepEqual(afterChanges.recommended, []);
});
