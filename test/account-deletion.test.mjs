import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountService } from '../server/account-service.mjs';
import { createAuthorControlService } from '../server/author-control-service.mjs';
import { createConsentService } from '../server/consent-service.mjs';
import { createDatabase, DELETED_ACCOUNT_ID } from '../server/database.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createNotificationService } from '../server/notification-service.mjs';
import { createReportService } from '../server/report-service.mjs';
import { createStoryResponseService } from '../server/story-response-service.mjs';
import { createStoryService } from '../server/story-service.mjs';

const LIMITS = { maxPerWindow: 100, maxPending: 100 };

function createFixture(t) {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const writer = database.findOrCreateAccount('writer-phone');
  const reader = database.findOrCreateAccount('reader-phone');
  const moderator = database.findOrCreateAccount('moderator-phone', new Date(), 'moderator');
  const as = (account, role = 'member') => ({ accountId: account.id, role, status: 'active' });
  const stories = createStoryService({ database, storyLimits: LIMITS });
  const responses = createStoryResponseService({ database, commentLimits: LIMITS, followUpLimits: LIMITS });
  const moderation = createModerationService({ database });
  const control = createAuthorControlService({ database });
  const reports = createReportService({ database });
  const notifications = createNotificationService({ database });
  const consents = createConsentService({ database, policyVersions: { privacy: 'p', community: 'c' } });
  const accounts = createAccountService({ database, storyService: stories, storyResponseService: responses });
  const reason = 'Recorded for the people involved.';
  const decide = (kind, id, decision) => (kind === 'story'
    ? moderation.decideStory({ session: as(moderator, 'moderator'), storyId: id, input: { decision, reason } })
    : moderation.decideComment({ session: as(moderator, 'moderator'), commentId: id, input: { decision, reason } }));
  const write = (account, title) => stories.createStory({
    accountId: account.id,
    input: { title, board: 'social', content: '失'.repeat(150), responsePreference: 'similar', tags: [], guidelinesAccepted: true }
  });

  // The writer's footprint across the system.
  consents.accept({ accountId: writer.id, policy: 'community', version: 'c' });
  const publicStory = write(writer, 'Public story');
  decide('story', publicStory.id, 'approve');
  const pendingStory = write(writer, 'Pending story');
  const readerStory = write(reader, 'Reader story');
  decide('story', readerStory.id, 'approve');
  const readerReply = responses.createComment({ accountId: reader.id, storyId: publicStory.id, input: { content: 'Same here.' } });
  decide('comment', readerReply.id, 'approve');
  const publicComment = responses.createComment({ accountId: writer.id, storyId: readerStory.id, input: { content: 'You are not alone.' } });
  decide('comment', publicComment.id, 'approve');
  const rejectedComment = responses.createComment({ accountId: writer.id, storyId: readerStory.id, input: { content: 'At my company it was worse.' } });
  decide('comment', rejectedComment.id, 'reject');
  control.appeal({
    accountId: writer.id, contentType: 'comment', contentId: rejectedComment.id,
    input: { reasonCode: 'other', explanation: 'My own words, please look again.' }
  });
  const privateUpdate = responses.createFollowUp({
    accountId: writer.id, storyId: publicStory.id, input: { status: 'still-difficult', visibility: 'private' }
  });
  reports.createReport({ accountId: writer.id, contentType: 'story', contentId: readerStory.id, input: { reasonCode: 'spam' } });
  reports.createReport({ accountId: reader.id, contentType: 'story', contentId: publicStory.id, input: { reasonCode: 'spam' } });

  return {
    database, writer, reader, moderator, as, stories, responses, moderation, notifications, accounts,
    publicStory, pendingStory, readerStory, readerReply, publicComment, privateUpdate
  };
}

test('export contains what the system holds about you, and nothing that identifies you', (t) => {
  const { writer, as, accounts } = createFixture(t);
  const data = accounts.exportData(as(writer));
  assert.deepEqual(data.stories.map(({ title }) => title).sort(), ['Pending story', 'Public story']);
  assert.equal(data.stories.find(({ title }) => title === 'Public story').followUps.length, 1);
  assert.equal(data.comments.length, 2);
  assert.equal(data.comments.find(({ moderationStatus }) => moderationStatus === 'rejected').appealExplanation, 'My own words, please look again.');
  assert.deepEqual(data.reportsFiled.map(({ reasonCode }) => reasonCode), ['spam']);
  assert.deepEqual(data.consents.map(({ policy, version }) => [policy, version]), [['community', 'c']]);
  assert.ok(data.notifications.length > 0);
  assert.equal(JSON.stringify(data).includes(writer.id), false, 'no internal account id');
  assert.throws(() => accounts.exportData(null), { code: 'authentication-required' });
});

test('deleting everything removes the content and the account, but keeps anonymous audit records', (t) => {
  const { database, writer, reader, as, stories, responses, moderation, notifications, accounts, moderator,
    publicStory, readerStory } = createFixture(t);
  assert.throws(() => accounts.deleteAccount({ session: as(writer), confirmation: 'yes' }), { code: 'deletion-not-confirmed' });

  assert.deepEqual(
    accounts.deleteAccount({ session: as(writer), keepPublicContent: false, confirmation: 'delete-my-account' }),
    { deleted: 5, kept: 0 }
  );
  assert.equal(database.findAccount(writer.id), null);
  const published = stories.listPublishedStories();
  assert.deepEqual(published.map(({ title }) => title), ['Reader story']);
  assert.equal(published[0].comments.length, 0, "the writer's response is gone");
  assert.equal(responses.listMyComments(reader.id).length, 0, 'replies to a deleted story go with it');
  assert.deepEqual(moderation.listReportedContent(as(moderator, 'moderator')), [], 'reports about deleted content go');
  assert.equal(notifications.list(reader.id).notifications.some(({ contentId }) => contentId === publicStory.id), false);
  assert.deepEqual(
    database.listModerationEvents(publicStory.id).map(({ action }) => action),
    ['submitted', 'approved'],
    'the review trail stays, without the content or the account'
  );
  assert.equal(stories.listPublishedStories().some(({ id }) => id === readerStory.id), true);

  // The same phone can start again with a fresh, empty account.
  const fresh = database.findOrCreateAccount('writer-phone');
  assert.notEqual(fresh.id, writer.id);
  assert.equal(stories.listMyStories(fresh.id).length, 0);
});

test('keeping public content leaves it online, unowned, and deletes the rest', (t) => {
  const { database, writer, as, stories, accounts, publicStory, publicComment, readerReply } = createFixture(t);
  assert.deepEqual(
    accounts.deleteAccount({ session: as(writer), keepPublicContent: true, confirmation: 'delete-my-account' }),
    { deleted: 3, kept: 2 }
  );
  const published = stories.listPublishedStories();
  const kept = published.find(({ id }) => id === publicStory.id);
  assert.ok(kept, 'the public story stays');
  assert.deepEqual(kept.comments.map(({ id }) => id), [readerReply.id], 'and so do replies to it');
  assert.equal(kept.followUps.length, 0, 'private follow-ups are always deleted');
  assert.ok(published.find(({ title }) => title === 'Reader story').comments.some(({ id }) => id === publicComment.id));
  assert.equal(database.findContentAuthor('story', publicStory.id), DELETED_ACCOUNT_ID);
  assert.equal(database.findAccount(DELETED_ACCOUNT_ID).status, 'suspended', 'nobody can sign in as the placeholder');
});

test('staff are removed from the team first; former staff can then delete', (t) => {
  const { database, moderator, as, accounts } = createFixture(t);
  assert.throws(
    () => accounts.deleteAccount({ session: as(moderator, 'moderator'), confirmation: 'delete-my-account' }),
    { code: 'staff-cannot-delete', status: 409 }
  );
  database.setStaffRole({ accountId: moderator.id, role: 'member', changedByAccountId: null, changedAt: new Date() });
  // Their past decisions reference the account; deletion must not be blocked by them.
  accounts.deleteAccount({ session: as(moderator), confirmation: 'delete-my-account' });
  assert.equal(database.findAccount(moderator.id), null);
  assert.ok(database.listRoleChanges(5).length > 0, 'role history stays, without the account');
});
