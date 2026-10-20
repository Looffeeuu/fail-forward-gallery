import { randomUUID } from 'node:crypto';
import { DELETED_ACCOUNT_ID } from './database.mjs';
import { StaffError } from './staff-service.mjs';

const CONTENT_TYPES = new Set(['story', 'comment', 'follow_up']);
const EXCERPT_LENGTH = 160;

function normaliseReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 8 || reason.length > 300) {
    throw new StaffError('invalid-suspension-reason', 400, 'Give a reason of 8-300 characters.');
  }
  return reason;
}

// Administrators stop an abusive account through something it wrote, so they
// never learn who it is. Suspended accounts are signed out and cannot sign in.
export function createSuspensionService({ database, now = () => new Date(), generateId = randomUUID }) {
  if (!database) throw new TypeError('Suspension service database is required.');

  function requireAdministrator(session) {
    if (!session) {
      throw new StaffError('authentication-required', 401, 'Sign in to manage accounts.');
    }
    if (session.role !== 'administrator') {
      throw new StaffError('administrator-required', 403, 'Administrator access is required.');
    }
  }

  function list() {
    return Object.freeze({
      suspensions: database.listSuspensions().map(({ content, ...suspension }) => Object.freeze({
        ...suspension,
        excerpt: content
          ? [content.title, content.content].filter(Boolean).join(' — ').slice(0, EXCERPT_LENGTH)
          : null
      }))
    });
  }

  return Object.freeze({
    list(session) {
      requireAdministrator(session);
      return list();
    },

    suspendAuthor({ session, contentType, contentId, reason }) {
      requireAdministrator(session);
      const id = String(contentId || '').trim();
      const authorId = CONTENT_TYPES.has(contentType) && id && id.length <= 100
        ? database.findContentAuthor(contentType, id)
        : null;
      if (!authorId) {
        throw new StaffError('content-not-found', 404, 'This content could not be found.');
      }
      if (authorId === DELETED_ACCOUNT_ID) {
        throw new StaffError(
          'author-unavailable',
          409,
          'This content belongs to a deleted account. Remove it through review instead.'
        );
      }
      const author = database.findAccount(authorId);
      if (author.role !== 'member') {
        throw new StaffError(
          'cannot-suspend-staff',
          409,
          'Remove this person from the review team before suspending the account.'
        );
      }
      if (author.status === 'suspended') {
        throw new StaffError('already-suspended', 409, 'This account is already suspended.');
      }
      database.suspendAccount({
        id: generateId(),
        accountId: authorId,
        contentType,
        contentId: id,
        reason: normaliseReason(reason),
        suspendedByAccountId: session.accountId,
        suspendedAt: now()
      });
      return list();
    },

    liftSuspension({ session, suspensionId, reason }) {
      requireAdministrator(session);
      const lifted = database.liftSuspension({
        suspensionId: String(suspensionId || ''),
        reason: normaliseReason(reason),
        liftedByAccountId: session.accountId,
        liftedAt: now()
      });
      if (!lifted) {
        throw new StaffError('suspension-not-active', 409, 'This suspension is not active.');
      }
      return list();
    }
  });
}
