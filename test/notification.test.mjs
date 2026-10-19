import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthorControlService } from '../server/author-control-service.mjs';
import { createDatabase } from '../server/database.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createNotificationService } from '../server/notification-service.mjs';
import { createStoryResponseService } from '../server/story-response-service.mjs';
import { createStoryService } from '../server/story-service.mjs';

test('authors are notified of every review decision on their content', (t) => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  let idCounter = 0;
  const generateId = () => `notice-${String(idCounter += 1).padStart(3, '0')}`;
  let currentTime = new Date('2026-10-19T01:00:00.000Z').getTime();
  const now = () => new Date(currentTime += 1000);
  const author = database.findOrCreateAccount('author-phone');
  const reader = database.findOrCreateAccount('reader-phone');
  const moderator = database.findOrCreateAccount('moderator-phone', new Date(), 'moderator');
  const session = { accountId: moderator.id, role: 'moderator', status: 'active' };
  const storyService = createStoryService({ database, now, generateId });
  const responseService = createStoryResponseService({ database, now, generateId });
  const controlService = createAuthorControlService({ database, now, generateId });
  const moderationService = createModerationService({ database, now });
  const notifications = createNotificationService({ database, now });
  const reason = { reason: 'Recorded for the author to read.' };

  const story = storyService.createStory({
    accountId: author.id,
    input: {
      title: 'Notice me',
      board: 'academic',
      content: '失'.repeat(150),
      responsePreference: 'advice',
      tags: [],
      guidelinesAccepted: true
    }
  });
  moderationService.decideStory({ session, storyId: story.id, input: { decision: 'approve', ...reason } });
  const comment = responseService.createComment({
    accountId: reader.id,
    storyId: story.id,
    input: { content: 'Try asking your tutor.' }
  });
  moderationService.decideComment({ session, commentId: comment.id, input: { decision: 'reject', ...reason } });
  controlService.appeal({
    accountId: reader.id,
    contentType: 'comment',
    contentId: comment.id,
    input: { reasonCode: 'within-guidelines', explanation: 'This is gentle advice only.' }
  });
  const [appeal] = moderationService.listPendingAppeals(session);
  moderationService.decideAppeal({
    session,
    appealId: appeal.id,
    input: { decision: 'overturn', ...reason }
  });

  const authorView = notifications.list(author.id);
  assert.deepEqual(
    authorView.notifications.map(({ kind, contentType, storyTitle }) => [kind, contentType, storyTitle]),
    [['approved', 'story', 'Notice me']]
  );
  const readerView = notifications.list(reader.id);
  assert.equal(readerView.unreadCount, 2);
  assert.deepEqual(
    readerView.notifications.map(({ kind, storyTitle }) => [kind, storyTitle]),
    [['appeal-overturned', 'Notice me'], ['rejected', 'Notice me']]
  );
  assert.equal('recipientAccountId' in readerView.notifications[0], false);

  const afterRead = notifications.markAllRead(reader.id);
  assert.equal(afterRead.unreadCount, 0);
  assert.ok(afterRead.notifications.every(({ readAt }) => readAt));
  assert.equal(notifications.list(author.id).unreadCount, 1);
  assert.throws(() => notifications.list(null), { code: 'authentication-required', status: 401 });
});
