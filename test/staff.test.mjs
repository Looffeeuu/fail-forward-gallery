import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthService, fingerprintPhone } from '../server/auth-service.mjs';
import { createDatabase } from '../server/database.mjs';
import { createStaffService } from '../server/staff-service.mjs';

const SECRET = 'staff-test-secret-that-is-long-enough';

function createFixture(t) {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const auth = createAuthService({
    database,
    smsProvider: { async sendVerificationCode() {} },
    secret: SECRET,
    verificationCooldownMs: 0,
    generateCode: () => '271828'
  });
  const staff = createStaffService({ database, secret: SECRET });

  async function signIn(phone) {
    await auth.requestCode({ phone, ip: '127.0.0.1' });
    const { sessionToken } = auth.verifyCode({ phone, code: '271828' });
    return () => auth.resolveSession(sessionToken);
  }

  // The first administrator is appointed by a server operator (as the CLI does).
  database.setStaffRoleByPhone({
    phoneFingerprint: fingerprintPhone(SECRET, '+8613800000001'),
    label: 'Lead admin',
    role: 'administrator',
    changedByAccountId: null,
    changedAt: new Date('2026-01-01T00:00:00.000Z')
  });

  return { auth, staff, signIn };
}

test('administrators appoint reviewers who gain access on first sign-in', async (t) => {
  const { staff, signIn } = createFixture(t);
  const admin = (await signIn('13800000001'))();
  assert.equal(admin.role, 'administrator');

  const team = staff.appoint({ session: admin, phone: '139 0000 0002', label: '审核员小林', role: 'moderator' });
  assert.deepEqual(team.staff.map(({ label, role }) => [label, role]), [
    ['Lead admin', 'administrator'],
    ['审核员小林', 'moderator']
  ]);
  assert.equal(JSON.stringify(team).includes('13900000002'), false, 'phone numbers are never returned');

  const reviewerSession = await signIn('13900000002');
  assert.equal(reviewerSession().role, 'moderator', 'the role is waiting at first sign-in');

  const reviewer = team.staff.find(({ label }) => label === '审核员小林');
  const after = staff.changeRole({ session: admin, accountId: reviewer.accountId, role: 'member' });
  assert.equal(reviewerSession().role, 'member', 'revocation applies to an open session at once');
  assert.deepEqual(after.staff.map(({ label }) => label), ['Lead admin']);
  assert.deepEqual(
    after.changes.map(({ label, previousRole, newRole, changedByLabel, byServerOperator }) => [
      label, previousRole, newRole, changedByLabel, byServerOperator
    ]),
    [
      ['审核员小林', 'moderator', 'member', 'Lead admin', false],
      ['审核员小林', 'member', 'moderator', 'Lead admin', false],
      ['Lead admin', 'member', 'administrator', '', true]
    ]
  );
});

test('only administrators manage the team, and never their own role', async (t) => {
  const { staff, signIn } = createFixture(t);
  const admin = (await signIn('13800000001'))();
  staff.appoint({ session: admin, phone: '13900000003', label: 'Reviewer', role: 'moderator' });
  const reviewer = (await signIn('13900000003'))();
  const member = (await signIn('13700000004'))();

  assert.throws(() => staff.listTeam(null), { code: 'authentication-required', status: 401 });
  assert.throws(() => staff.listTeam(member), { code: 'administrator-required', status: 403 });
  assert.throws(() => staff.listTeam(reviewer), { code: 'administrator-required', status: 403 });

  assert.throws(
    () => staff.changeRole({ session: admin, accountId: admin.accountId, role: 'member' }),
    { code: 'cannot-change-own-role', status: 409 }
  );
  assert.throws(
    () => staff.appoint({ session: admin, phone: '13800000001', label: 'Lead admin', role: 'moderator' }),
    { code: 'cannot-change-own-role' },
    'entering your own number is not a way around the rule'
  );
  const renamed = staff.appoint({ session: admin, phone: '13800000001', label: 'Project lead', role: 'administrator' });
  assert.equal(renamed.staff[0].label, 'Project lead', 'renaming yourself is fine');

  assert.throws(() => staff.appoint({ session: admin, phone: '12345', label: 'Name', role: 'moderator' }), { code: 'invalid-phone' });
  assert.throws(() => staff.appoint({ session: admin, phone: '13900000005', label: 'X', role: 'moderator' }), { code: 'invalid-staff-label' });
  assert.throws(() => staff.appoint({ session: admin, phone: '13900000005', label: 'Name', role: 'member' }), { code: 'invalid-role' });
  assert.throws(
    () => staff.changeRole({ session: admin, accountId: member.accountId, role: 'moderator' }),
    { code: 'staff-not-found', status: 404 },
    'members are appointed by phone, not by guessing account ids'
  );
});
