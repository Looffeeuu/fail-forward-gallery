import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountService } from '../server/account-service.mjs';
import { createAuthService, fingerprintPhone } from '../server/auth-service.mjs';
import { createDatabase } from '../server/database.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createStoryResponseService } from '../server/story-response-service.mjs';
import { createStoryService } from '../server/story-service.mjs';
import { createSuspensionService } from '../server/suspension-service.mjs';

const SECRET = 'suspension-test-secret-that-is-long-enough';

test('administrators suspend an account through its content, without seeing who it is', async (t) => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const auth = createAuthService({
    database,
    smsProvider: { async sendVerificationCode() {} },
    secret: SECRET,
    verificationCooldownMs: 0,
    generateCode: () => '141421'
  });
  const signIn = async (phone) => {
    await auth.requestCode({ phone, ip: '127.0.0.1' });
    const { sessionToken } = auth.verifyCode({ phone, code: '141421' });
    return () => auth.resolveSession(sessionToken);
  };
  const appoint = (phone, label, role) => database.setStaffRoleByPhone({
    phoneFingerprint: fingerprintPhone(SECRET, `+86${phone}`), label, role, changedByAccountId: null, changedAt: new Date()
  });
  appoint('13800000001', 'Lead admin', 'administrator');
  appoint('13900000002', 'Reviewer', 'moderator');
  const admin = (await signIn('13800000001'))();
  const reviewer = (await signIn('13900000002'))();
  const writerSession = await signIn('13700000003');
  const writer = writerSession();

  const stories = createStoryService({ database });
  const responses = createStoryResponseService({ database });
  const moderation = createModerationService({ database });
  const suspensions = createSuspensionService({ database });
  const accounts = createAccountService({ database, storyService: stories, storyResponseService: responses });
  const story = stories.createStory({
    accountId: writer.accountId,
    input: { title: 'Abusive title', board: 'social', content: '失'.repeat(150), responsePreference: 'none', tags: [], guidelinesAccepted: true }
  });
  const reviewerStory = stories.createStory({
    accountId: reviewer.accountId,
    input: { title: 'Reviewer story', board: 'social', content: '失'.repeat(150), responsePreference: 'none', tags: [], guidelinesAccepted: true }
  });
  const reason = 'Repeated harassment in several submissions.';

  assert.throws(
    () => suspensions.suspendAuthor({ session: reviewer, contentType: 'story', contentId: story.id, reason }),
    { code: 'administrator-required', status: 403 }
  );
  assert.throws(
    () => suspensions.suspendAuthor({ session: admin, contentType: 'story', contentId: story.id, reason: 'short' }),
    { code: 'invalid-suspension-reason' }
  );
  assert.throws(
    () => suspensions.suspendAuthor({ session: admin, contentType: 'story', contentId: reviewerStory.id, reason }),
    { code: 'cannot-suspend-staff', status: 409 }
  );

  const result = suspensions.suspendAuthor({ session: admin, contentType: 'story', contentId: story.id, reason });
  assert.equal(writerSession(), null, 'signed out everywhere at once');
  await auth.requestCode({ phone: '13700000003', ip: '127.0.0.1' });
  assert.throws(() => auth.verifyCode({ phone: '13700000003', code: '141421' }), { code: 'account-suspended', status: 403 });

  const [entry] = result.suspensions;
  assert.equal(entry.reason, reason);
  assert.equal(entry.suspendedByLabel, 'Lead admin');
  assert.match(entry.excerpt, /^Abusive title — 失/);
  assert.equal(JSON.stringify(result).includes(writer.accountId), false, 'the account stays anonymous');
  assert.throws(
    () => suspensions.suspendAuthor({ session: admin, contentType: 'story', contentId: story.id, reason }),
    { code: 'already-suspended' }
  );

  // Lifting restores sign-in and keeps the record.
  assert.throws(() => suspensions.liftSuspension({ session: admin, suspensionId: entry.id, reason: 'no' }), { code: 'invalid-suspension-reason' });
  const lifted = suspensions.liftSuspension({ session: admin, suspensionId: entry.id, reason: 'Agreed to follow the rules.' });
  assert.equal(lifted.suspensions[0].liftReason, 'Agreed to follow the rules.');
  assert.throws(
    () => suspensions.liftSuspension({ session: admin, suspensionId: entry.id, reason: 'Lifting twice is refused.' }),
    { code: 'suspension-not-active', status: 409 }
  );
  const restored = await signIn('13700000003');
  assert.equal(restored().accountId, writer.accountId);

  // Content left by a deleted account belongs to nobody, so there is no one to suspend.
  moderation.decideStory({ session: admin, storyId: story.id, input: { decision: 'approve', reason: 'Fine to publish.' } });
  accounts.deleteAccount({ session: restored(), keepPublicContent: true, confirmation: 'delete-my-account' });
  assert.equal(
    suspensions.list(admin).suspensions[0].liftReason,
    'Agreed to follow the rules.',
    'the suspension record outlives the deleted account'
  );
  assert.throws(
    () => suspensions.suspendAuthor({ session: admin, contentType: 'story', contentId: story.id, reason }),
    { code: 'author-unavailable' }
  );
  assert.throws(
    () => suspensions.suspendAuthor({ session: admin, contentType: 'story', contentId: 'missing', reason }),
    { code: 'content-not-found', status: 404 }
  );
});
