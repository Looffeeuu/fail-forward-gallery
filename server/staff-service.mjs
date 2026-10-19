import { fingerprintPhone, normaliseMainlandPhone } from './auth-service.mjs';

const STAFF_ROLES = new Set(['moderator', 'administrator']);
const ASSIGNABLE_ROLES = new Set(['member', 'moderator', 'administrator']);

export class StaffError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'StaffError';
    this.code = code;
    this.status = status;
  }
}

function normaliseLabel(value) {
  const label = String(value || '').trim();
  if (label.length < 2 || label.length > 40) {
    throw new StaffError('invalid-staff-label', 400, 'Give the team member a name of 2-40 characters.');
  }
  return label;
}

// Appointing and removing reviewers and administrators. Role changes take
// effect on the person's next request, because sessions read the role live.
// Administrators cannot change their own role, so at least one always remains.
export function createStaffService({ database, secret, now = () => new Date() }) {
  if (!database || !secret) throw new TypeError('Staff service dependencies are required.');

  function requireAdministrator(session) {
    if (!session) {
      throw new StaffError('authentication-required', 401, 'Sign in to manage the team.');
    }
    if (session.role !== 'administrator') {
      throw new StaffError('administrator-required', 403, 'Administrator access is required.');
    }
  }

  function team(session) {
    return Object.freeze({
      staff: database.listStaff().map((member) => Object.freeze({
        ...member,
        isYou: member.accountId === session.accountId
      })),
      changes: database.listRoleChanges(20)
    });
  }

  return Object.freeze({
    listTeam(session) {
      requireAdministrator(session);
      return team(session);
    },

    appoint({ session, phone, label, role }) {
      requireAdministrator(session);
      const normalisedPhone = normaliseMainlandPhone(phone);
      if (!normalisedPhone) {
        throw new StaffError('invalid-phone', 400, 'Enter a valid mainland China mobile number.');
      }
      if (!STAFF_ROLES.has(role)) {
        throw new StaffError('invalid-role', 400, 'Choose reviewer or administrator.');
      }
      const phoneFingerprint = fingerprintPhone(secret, normalisedPhone);
      // Entering your own number must not become a way around the self-change rule.
      const current = database.findAccountByPhone(phoneFingerprint);
      if (current?.id === session.accountId && role !== current.role) {
        throw new StaffError(
          'cannot-change-own-role',
          409,
          'Ask another administrator to change your own role.'
        );
      }
      database.setStaffRoleByPhone({
        phoneFingerprint,
        label: normaliseLabel(label),
        role,
        changedByAccountId: session.accountId,
        changedAt: now()
      });
      return team(session);
    },

    changeRole({ session, accountId, role }) {
      requireAdministrator(session);
      if (!ASSIGNABLE_ROLES.has(role)) {
        throw new StaffError('invalid-role', 400, 'Choose member, reviewer, or administrator.');
      }
      if (accountId === session.accountId) {
        throw new StaffError(
          'cannot-change-own-role',
          409,
          'Ask another administrator to change your own role.'
        );
      }
      const account = database.findAccount(String(accountId || ''));
      if (!account || !STAFF_ROLES.has(account.role)) {
        throw new StaffError('staff-not-found', 404, 'This team member could not be found.');
      }
      database.setStaffRole({
        accountId: account.id,
        role,
        changedByAccountId: session.accountId,
        changedAt: now()
      });
      return team(session);
    }
  });
}
