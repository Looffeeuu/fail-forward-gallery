import { StoryError } from './story-service.mjs';

// In-site review notices. Email delivery is deferred until production
// infrastructure exists; these records are the source either channel will read.
export function createNotificationService({ database, now = () => new Date() }) {
  if (!database) throw new TypeError('Notification service database is required.');

  function requireAccount(accountId) {
    if (!accountId) {
      throw new StoryError('authentication-required', 401, 'Sign in to view notifications.');
    }
  }

  return Object.freeze({
    list(accountId) {
      requireAccount(accountId);
      return database.listNotifications(accountId);
    },

    markAllRead(accountId) {
      requireAccount(accountId);
      database.markNotificationsRead(accountId, now());
      return database.listNotifications(accountId);
    }
  });
}
