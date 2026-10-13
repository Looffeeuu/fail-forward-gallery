import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '../server/database.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createStoryResponseService } from '../server/story-response-service.mjs';
import { createStoryService } from '../server/story-service.mjs';

function createFixture(t) {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  let idCounter = 0;
  const generateId = () => `response-fixture-${idCounter += 1}`;
  const author = database.findOrCreateAccount('author-phone');
  const reader = database.findOrCreateAccount('reader-phone');
  const moderator = database.findOrCreateAccount('moderator-phone', new Date(), 'moderator');
  const storyService = createStoryService({ database, generateId });
  const responseService = createStoryResponseService({
    database,
    now: () => new Date('2026-10-13T02:00:00.000Z'),
    generateId
  });
  const moderationService = createModerationService({
    database,
    now: () => new Date('2026-10-13T03:00:00.000Z')
  });
  const moderatorSession = { accountId: moderator.id, role: 'moderator', status: 'active' };

  function publishStory(responsePreference) {
    const story = storyService.createStory({
      accountId: author.id,
      input: {
        title: `A ${responsePreference} story`,
        board: 'academic',
        content: '失'.repeat(150),
        responsePreference,
        tags: ['ExamFailure'],
        guidelinesAccepted: true
      }
    });
    moderationService.decideStory({
      session: moderatorSession,
      storyId: story.id,
      input: { decision: 'approve', reason: 'Meets the community guidelines.' }
    });
    return story;
  }

  return {
    database,
    author,
    reader,
    storyService,
    responseService,
    moderationService,
    moderatorSession,
    publishStory
  };
}

test('comments follow the author boundary and stay private until approved', (t) => {
  const {
    database,
    author,
    reader,
    storyService,
    responseService,
    moderationService,
    moderatorSession,
    publishStory
  } = createFixture(t);
  const openStory = publishStory('encouragement');
  const closedStory = publishStory('none');

  assert.throws(
    () => responseService.createComment({
      accountId: reader.id,
      storyId: closedStory.id,
      input: { content: 'I hear you.' }
    }),
    { code: 'comments-closed', status: 403 }
  );
  assert.throws(
    () => responseService.createComment({
      accountId: null,
      storyId: openStory.id,
      input: { content: 'I hear you.' }
    }),
    { code: 'authentication-required', status: 401 }
  );
  assert.throws(
    () => responseService.createComment({
      accountId: reader.id,
      storyId: openStory.id,
      input: { content: '   ' }
    }),
    { code: 'invalid-comment' }
  );

  const pendingStory = storyService.createStory({
    accountId: author.id,
    input: {
      title: 'Not yet reviewed',
      board: 'academic',
      content: '失'.repeat(150),
      responsePreference: 'encouragement',
      tags: [],
      guidelinesAccepted: true
    }
  });
  assert.throws(
    () => responseService.createComment({
      accountId: reader.id,
      storyId: pendingStory.id,
      input: { content: 'I hear you.' }
    }),
    { code: 'story-not-found', status: 404 }
  );

  const comment = responseService.createComment({
    accountId: reader.id,
    storyId: openStory.id,
    input: { content: '  You kept going, and that matters.  ', responseType: 'advice' }
  });
  assert.equal(comment.responseType, 'encouragement');
  assert.equal(comment.content, 'You kept going, and that matters.');
  assert.equal(comment.moderationStatus, 'pending-human-review');
  assert.equal(
    storyService.listPublishedStories().find(({ id }) => id === openStory.id).comments.length,
    0
  );

  assert.throws(
    () => moderationService.listPendingComments({ accountId: reader.id, role: 'member' }),
    { code: 'moderator-required', status: 403 }
  );
  const queue = moderationService.listPendingComments(moderatorSession);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].storyTitle, openStory.title);
  assert.equal('authorAccountId' in queue[0], false);

  moderationService.decideComment({
    session: moderatorSession,
    commentId: comment.id,
    input: { decision: 'approve', reason: 'Kind and within the chosen boundary.' }
  });
  const publicComments = storyService.listPublishedStories()
    .find(({ id }) => id === openStory.id).comments;
  assert.deepEqual(publicComments, [{
    id: comment.id,
    responseType: 'encouragement',
    content: 'You kept going, and that matters.',
    publishedAt: '2026-10-13T03:00:00.000Z'
  }]);

  assert.throws(
    () => moderationService.decideComment({
      session: moderatorSession,
      commentId: comment.id,
      input: { decision: 'reject', reason: 'A completed decision cannot change.' }
    }),
    { code: 'review-conflict', status: 409 }
  );
  assert.deepEqual(
    database.listModerationEvents(comment.id, 'comment').map(({ action }) => action),
    ['submitted', 'approved']
  );

  const myComments = responseService.listMyComments(reader.id);
  assert.equal(myComments[0].moderationStatus, 'approved');
  assert.equal(myComments[0].decisionReason, 'Kind and within the chosen boundary.');
});

test('only the original author can add follow-ups and private ones skip review', (t) => {
  const {
    author,
    reader,
    storyService,
    responseService,
    moderationService,
    moderatorSession,
    publishStory
  } = createFixture(t);
  const story = publishStory('none');

  assert.throws(
    () => responseService.createFollowUp({
      accountId: reader.id,
      storyId: story.id,
      input: { status: 'small-steps', visibility: 'anonymous-public' }
    }),
    { code: 'follow-up-author-only', status: 403 }
  );
  assert.throws(
    () => responseService.createFollowUp({
      accountId: author.id,
      storyId: story.id,
      input: { status: 'all-fixed', visibility: 'anonymous-public' }
    }),
    { code: 'invalid-follow-up-status' }
  );
  assert.throws(
    () => responseService.createFollowUp({
      accountId: author.id,
      storyId: story.id,
      input: { status: 'small-steps', visibility: 'everyone' }
    }),
    { code: 'invalid-visibility' }
  );

  const privateUpdate = responseService.createFollowUp({
    accountId: author.id,
    storyId: story.id,
    input: { status: 'still-difficult', content: 'Only for me.', visibility: 'private' }
  });
  assert.equal(privateUpdate.moderationStatus, 'private');
  const publicUpdate = responseService.createFollowUp({
    accountId: author.id,
    storyId: story.id,
    input: { status: 'no-major-change', visibility: 'anonymous-public' }
  });
  assert.equal(publicUpdate.moderationStatus, 'pending-human-review');
  assert.equal(publicUpdate.content, '');

  const queue = moderationService.listPendingFollowUps(moderatorSession);
  assert.deepEqual(queue.map(({ id }) => id), [publicUpdate.id]);

  moderationService.decideFollowUp({
    session: moderatorSession,
    followUpId: publicUpdate.id,
    input: { decision: 'approve', reason: 'A valid update without identifying details.' }
  });
  const publicStory = storyService.listPublishedStories().find(({ id }) => id === story.id);
  assert.deepEqual(publicStory.followUps.map(({ id }) => id), [publicUpdate.id]);
  assert.equal('visibility' in publicStory.followUps[0], false);

  const ownedStory = storyService.listMyStories(author.id).find(({ id }) => id === story.id);
  assert.deepEqual(
    ownedStory.followUps.map(({ id, moderationStatus }) => [id, moderationStatus]),
    [[privateUpdate.id, 'private'], [publicUpdate.id, 'approved']]
  );
  assert.equal(storyService.listMyStories(reader.id).length, 0);
});
