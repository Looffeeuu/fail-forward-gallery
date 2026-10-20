import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthorControlService } from '../server/author-control-service.mjs';
import { createDatabase } from '../server/database.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createReportService } from '../server/report-service.mjs';
import { createStoryResponseService } from '../server/story-response-service.mjs';
import { createStoryService } from '../server/story-service.mjs';

// Found in the pre-pilot audit: a reviewer could approve their own writing.
test('reviewers never review their own content, and it waits for another reviewer', (t) => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const writingReviewer = database.findOrCreateAccount('writing-reviewer', new Date(), 'moderator');
  const otherReviewer = database.findOrCreateAccount('other-reviewer', new Date(), 'moderator');
  const reader = database.findOrCreateAccount('reader');
  const as = (account) => ({ accountId: account.id, role: 'moderator', status: 'active' });
  const stories = createStoryService({ database });
  const responses = createStoryResponseService({ database });
  const control = createAuthorControlService({ database });
  const reports = createReportService({ database });
  const moderation = createModerationService({ database });
  const reason = 'Recorded for the people involved.';

  const own = stories.createStory({
    accountId: writingReviewer.id,
    input: { title: 'Mine', board: 'social', content: '失'.repeat(150), responsePreference: 'advice', tags: [], guidelinesAccepted: true }
  });
  assert.deepEqual(moderation.listPendingStories(as(writingReviewer)), [], 'own work is not in your queue');
  assert.throws(
    () => moderation.decideStory({ session: as(writingReviewer), storyId: own.id, input: { decision: 'approve', reason } }),
    { code: 'own-content', status: 403 }
  );
  assert.deepEqual(moderation.listPendingStories(as(otherReviewer)).map(({ id }) => id), [own.id]);
  moderation.decideStory({ session: as(otherReviewer), storyId: own.id, input: { decision: 'approve', reason } });

  assert.throws(
    () => moderation.recommendStory({ session: as(writingReviewer), storyId: own.id, input: { reason: 'My own favourite.' } }),
    { code: 'own-content' }
  );

  // Reports and appeals about your own content also go to someone else.
  reports.createReport({ accountId: reader.id, contentType: 'story', contentId: own.id, input: { reasonCode: 'spam' } });
  assert.deepEqual(moderation.listReportedContent(as(writingReviewer)), []);
  assert.throws(
    () => moderation.decideReports({
      session: as(writingReviewer), contentType: 'story', contentId: own.id, input: { decision: 'dismiss', reason }
    }),
    { code: 'own-content' }
  );
  moderation.decideReports({
    session: as(otherReviewer), contentType: 'story', contentId: own.id, input: { decision: 'remove', reason }
  });
  control.appeal({
    accountId: writingReviewer.id,
    contentType: 'story',
    contentId: own.id,
    input: { reasonCode: 'within-guidelines', explanation: 'I believe this follows the rules.' }
  });
  assert.deepEqual(moderation.listPendingAppeals(as(writingReviewer)), []);
  const [appeal] = moderation.listPendingAppeals(as(otherReviewer));
  assert.throws(
    () => moderation.decideAppeal({ session: as(writingReviewer), appealId: appeal.id, input: { decision: 'overturn', reason } }),
    { code: 'own-content' }
  );

  // Responses and follow-ups, including safety holds.
  const otherStory = stories.createStory({
    accountId: reader.id,
    input: { title: 'Theirs', board: 'social', content: '失'.repeat(150), responsePreference: 'advice', tags: [], guidelinesAccepted: true }
  });
  moderation.decideStory({ session: as(otherReviewer), storyId: otherStory.id, input: { decision: 'approve', reason } });
  const ownComment = responses.createComment({
    accountId: writingReviewer.id, storyId: otherStory.id, input: { content: 'Some days I want to die too.' }
  });
  assert.deepEqual(moderation.listPendingComments(as(writingReviewer)), []);
  moderation.decideComment({
    session: as(otherReviewer), commentId: ownComment.id, input: { decision: 'safety-hold', reason }
  });
  assert.deepEqual(moderation.listHeldContent(as(writingReviewer)), []);
  assert.throws(
    () => moderation.decideHeld({
      session: as(writingReviewer), contentType: 'comment', contentId: ownComment.id, input: { decision: 'release', reason }
    }),
    { code: 'own-content' }
  );
});
