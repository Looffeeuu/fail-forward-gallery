import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthorControlService } from '../server/author-control-service.mjs';
import { createDatabase } from '../server/database.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createStoryResponseService } from '../server/story-response-service.mjs';
import { createStoryService } from '../server/story-service.mjs';

function createFixture(t) {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  let idCounter = 0;
  const generateId = () => `control-${String(idCounter += 1).padStart(3, '0')}`;
  const now = () => new Date('2026-10-13T05:00:00.000Z');
  const author = database.findOrCreateAccount('author-phone');
  const reader = database.findOrCreateAccount('reader-phone');
  const firstModerator = database.findOrCreateAccount('first-moderator', new Date(), 'moderator');
  const secondModerator = database.findOrCreateAccount('second-moderator', new Date(), 'moderator');
  const storyService = createStoryService({ database, now, generateId });
  const responseService = createStoryResponseService({ database, now, generateId });
  const controlService = createAuthorControlService({ database, now, generateId });
  const moderationService = createModerationService({ database, now });
  const reviewer = (account) => ({ accountId: account.id, role: 'moderator', status: 'active' });
  const firstReviewer = reviewer(firstModerator);
  const secondReviewer = reviewer(secondModerator);

  function submitStory(responsePreference = 'encouragement') {
    return storyService.createStory({
      accountId: author.id,
      input: {
        title: 'A story to manage',
        board: 'social',
        content: '失'.repeat(150),
        responsePreference,
        tags: [],
        guidelinesAccepted: true
      }
    });
  }

  function decide(kind, id, decision, session = firstReviewer) {
    const input = { decision, reason: 'Recorded for the author to read.' };
    if (kind === 'story') return moderationService.decideStory({ session, storyId: id, input });
    return moderationService.decideComment({ session, commentId: id, input });
  }

  return {
    database,
    author,
    reader,
    storyService,
    responseService,
    controlService,
    moderationService,
    firstReviewer,
    secondReviewer,
    submitStory,
    decide
  };
}

test('authors can withdraw their own content in any state, immediately', (t) => {
  const {
    database,
    author,
    reader,
    storyService,
    responseService,
    controlService,
    moderationService,
    firstReviewer,
    submitStory,
    decide
  } = createFixture(t);

  const pendingStory = submitStory();
  assert.throws(
    () => controlService.withdraw({ accountId: reader.id, contentType: 'story', contentId: pendingStory.id }),
    { code: 'content-not-found', status: 404 }
  );
  const withdrawnPending = controlService.withdraw({
    accountId: author.id,
    contentType: 'story',
    contentId: pendingStory.id
  });
  assert.equal(withdrawnPending.moderationStatus, 'withdrawn');
  assert.equal(moderationService.listPendingStories(firstReviewer).length, 0);
  assert.throws(() => decide('story', pendingStory.id, 'approve'), { code: 'review-conflict' });
  assert.deepEqual(
    database.listModerationEvents(pendingStory.id).map(({ action }) => action),
    ['submitted', 'withdrawn']
  );

  const publicStory = submitStory();
  decide('story', publicStory.id, 'approve');
  const approvedComment = responseService.createComment({
    accountId: reader.id,
    storyId: publicStory.id,
    input: { content: 'Thank you for sharing this.' }
  });
  decide('comment', approvedComment.id, 'approve');
  const pendingComment = responseService.createComment({
    accountId: reader.id,
    storyId: publicStory.id,
    input: { content: 'A second thought.' }
  });
  const privateFollowUp = responseService.createFollowUp({
    accountId: author.id,
    storyId: publicStory.id,
    input: { status: 'still-difficult', visibility: 'private' }
  });

  controlService.withdraw({ accountId: reader.id, contentType: 'comment', contentId: approvedComment.id });
  assert.equal(storyService.listPublishedStories()[0].comments.length, 0);

  assert.equal(
    controlService.withdraw({
      accountId: author.id,
      contentType: 'follow_up',
      contentId: privateFollowUp.id
    }).moderationStatus,
    'withdrawn'
  );

  controlService.withdraw({ accountId: author.id, contentType: 'story', contentId: publicStory.id });
  assert.equal(storyService.listPublishedStories().length, 0);
  // Responses to a story that is no longer public do not wait for reviewers.
  assert.equal(moderationService.listPendingComments(firstReviewer).length, 0);
  assert.equal(
    responseService.listMyComments(reader.id).find(({ id }) => id === pendingComment.id).moderationStatus,
    'pending-human-review'
  );

  // Withdrawing twice is harmless and records a single event.
  controlService.withdraw({ accountId: author.id, contentType: 'story', contentId: publicStory.id });
  assert.deepEqual(
    database.listModerationEvents(publicStory.id).map(({ action }) => action),
    ['submitted', 'approved', 'withdrawn']
  );
});

test('each rejection can be appealed once and decided by any reviewer', (t) => {
  const {
    database,
    author,
    reader,
    storyService,
    responseService,
    controlService,
    moderationService,
    firstReviewer,
    secondReviewer,
    submitStory,
    decide
  } = createFixture(t);
  const story = submitStory();
  decide('story', story.id, 'approve');
  const comment = responseService.createComment({
    accountId: reader.id,
    storyId: story.id,
    input: { content: 'My cousin at that company said the same.' }
  });
  const appealComment = (input) => controlService.appeal({
    accountId: reader.id,
    contentType: 'comment',
    contentId: comment.id,
    input
  });
  const validAppeal = {
    reasonCode: 'no-identifying-details',
    explanation: 'I did not name the company or my cousin.'
  };

  assert.throws(() => appealComment(validAppeal), { code: 'appeal-not-available', status: 409 });
  decide('comment', comment.id, 'reject');
  assert.throws(
    () => controlService.appeal({
      accountId: author.id,
      contentType: 'comment',
      contentId: comment.id,
      input: validAppeal
    }),
    { code: 'content-not-found' }
  );
  assert.throws(
    () => appealComment({ reasonCode: 'unfair', explanation: validAppeal.explanation }),
    { code: 'invalid-appeal-reason' }
  );
  assert.throws(
    () => appealComment({ reasonCode: 'other', explanation: 'Too short' }),
    { code: 'invalid-appeal-explanation' }
  );

  assert.equal(appealComment(validAppeal).appealStatus, 'pending');
  assert.throws(() => appealComment(validAppeal), { code: 'appeal-already-submitted', status: 409 });

  const [firstView] = moderationService.listPendingAppeals(firstReviewer);
  const [secondView] = moderationService.listPendingAppeals(secondReviewer);
  assert.equal(firstView.originalDecisionByYou, true);
  assert.equal(secondView.originalDecisionByYou, false);
  assert.equal(firstView.contentType, 'comment');
  assert.equal(firstView.content.content, 'My cousin at that company said the same.');
  assert.equal(firstView.originalDecisionReason, 'Recorded for the author to read.');
  assert.equal('originalDeciderAccountId' in firstView, false);

  const outcome = moderationService.decideAppeal({
    session: secondReviewer,
    appealId: firstView.id,
    input: { decision: 'overturn', reason: 'No identifiable person is named.' }
  });
  assert.equal(outcome.status, 'overturned');
  assert.equal(storyService.listPublishedStories()[0].comments.length, 1);
  const ownComment = responseService.listMyComments(reader.id)[0];
  assert.equal(ownComment.moderationStatus, 'approved');
  assert.equal(ownComment.appealStatus, 'overturned');
  assert.equal(ownComment.appealDecisionReason, 'No identifiable person is named.');
  assert.deepEqual(
    database.listModerationEvents(comment.id, 'comment').map(({ action }) => action),
    ['submitted', 'rejected', 'appealed', 'appeal-overturned']
  );
  assert.throws(
    () => moderationService.decideAppeal({
      session: firstReviewer,
      appealId: firstView.id,
      input: { decision: 'uphold', reason: 'A second decision is not allowed.' }
    }),
    { code: 'review-conflict', status: 409 }
  );

  // Upholding leaves the content private; withdrawing removes a pending appeal.
  const upheldStory = submitStory();
  decide('story', upheldStory.id, 'reject');
  controlService.appeal({
    accountId: author.id,
    contentType: 'story',
    contentId: upheldStory.id,
    input: { reasonCode: 'within-guidelines', explanation: 'The story follows every rule listed.' }
  });
  const [upheldAppeal] = moderationService.listPendingAppeals(firstReviewer);
  moderationService.decideAppeal({
    session: firstReviewer,
    appealId: upheldAppeal.id,
    input: { decision: 'uphold', reason: 'The story names a specific classmate.' }
  });
  const ownStory = storyService.listMyStories(author.id).find(({ id }) => id === upheldStory.id);
  assert.equal(ownStory.moderationStatus, 'rejected');
  assert.equal(ownStory.appealStatus, 'upheld');

  const withdrawnStory = submitStory();
  decide('story', withdrawnStory.id, 'reject');
  controlService.appeal({
    accountId: author.id,
    contentType: 'story',
    contentId: withdrawnStory.id,
    input: { reasonCode: 'other', explanation: 'I would like another reviewer to read it.' }
  });
  const [withdrawnAppeal] = moderationService.listPendingAppeals(firstReviewer);
  controlService.withdraw({ accountId: author.id, contentType: 'story', contentId: withdrawnStory.id });
  assert.equal(moderationService.listPendingAppeals(firstReviewer).length, 0);
  assert.throws(
    () => moderationService.decideAppeal({
      session: firstReviewer,
      appealId: withdrawnAppeal.id,
      input: { decision: 'overturn', reason: 'The author already withdrew this.' }
    }),
    { code: 'review-conflict' }
  );
});
