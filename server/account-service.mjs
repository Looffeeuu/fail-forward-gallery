import { StoryError } from './story-service.mjs';

const DELETE_CONFIRMATION = 'delete-my-account';

// A person's own controls over their whole account: a copy of everything held
// about them, and deletion.
export function createAccountService({
  database,
  storyService,
  storyResponseService,
  now = () => new Date()
}) {
  if (!database || !storyService || !storyResponseService) {
    throw new TypeError('Account service dependencies are required.');
  }

  function requireAccount(accountId) {
    if (!accountId) {
      throw new StoryError('authentication-required', 401, 'Sign in to manage your account.');
    }
  }

  return Object.freeze({
    exportData(session) {
      requireAccount(session?.accountId);
      const account = database.findAccount(session.accountId);
      const records = database.exportAccountRecords(session.accountId);
      return Object.freeze({
        exportedAt: now().toISOString(),
        note: 'Fail Forward Gallery does not store your mobile number, so it is not included.',
        account: { role: account.role, status: account.status, createdAt: account.createdAt },
        consents: records.consents,
        stories: storyService.listMyStories(session.accountId),
        comments: storyResponseService.listMyComments(session.accountId),
        reportsFiled: records.reportsFiled,
        notifications: records.notifications
      });
    },

    deleteAccount({ session, keepPublicContent, confirmation }) {
      requireAccount(session?.accountId);
      // Removing staff goes through an administrator, so the last one cannot vanish.
      if (session.role !== 'member') {
        throw new StoryError(
          'staff-cannot-delete',
          409,
          'Ask an administrator to remove you from the review team before deleting your account.'
        );
      }
      if (confirmation !== DELETE_CONFIRMATION) {
        throw new StoryError('deletion-not-confirmed', 400, 'Confirm that you want to delete your account.');
      }
      return Object.freeze(database.deleteAccount({
        accountId: session.accountId,
        keepPublicContent: keepPublicContent === true,
        deletedAt: now()
      }));
    }
  });
}
