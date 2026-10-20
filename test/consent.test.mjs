import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { createAuthService } from '../server/auth-service.mjs';
import { createConsentService } from '../server/consent-service.mjs';
import { createDatabase } from '../server/database.mjs';
import { loadPolicyVersions } from '../server/policies.mjs';
import { createStoryService } from '../server/story-service.mjs';

const STORY = {
  title: 'Before I write',
  board: 'academic',
  content: '失'.repeat(150),
  responsePreference: 'none',
  tags: [],
  guidelinesAccepted: true
};

test('policy versions come from the shared policies.json', () => {
  const versions = loadPolicyVersions(resolve('.'));
  assert.match(versions.privacy, /\S/);
  assert.match(versions.community, /\S/);
});

test('signing in requires the current privacy notice and records it', async (t) => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const policyVersions = { privacy: 'p-1', community: 'c-1' };
  const auth = createAuthService({
    database,
    smsProvider: { async sendVerificationCode() {} },
    secret: 'consent-test-secret-that-is-long-enough',
    verificationCooldownMs: 0,
    generateCode: () => '161803',
    policyVersions
  });
  const consents = createConsentService({ database, policyVersions });
  const phone = '13800138000';

  await assert.rejects(
    auth.requestCode({ phone, ip: '127.0.0.1' }),
    { code: 'privacy-consent-required' },
    'no code is sent, so the number is not collected, before agreement'
  );
  await assert.rejects(
    auth.requestCode({ phone, ip: '127.0.0.1', privacyVersion: 'p-0' }),
    { code: 'privacy-consent-required' }
  );
  await auth.requestCode({ phone, ip: '127.0.0.1', privacyVersion: 'p-1' });
  assert.throws(() => auth.verifyCode({ phone, code: '161803' }), { code: 'privacy-consent-required' });
  const { sessionToken } = auth.verifyCode({ phone, code: '161803', privacyVersion: 'p-1' });
  const { accountId } = auth.resolveSession(sessionToken);

  assert.deepEqual(consents.status(accountId), {
    privacy: { version: 'p-1', accepted: true },
    community: { version: 'c-1', accepted: false }
  });
});

test('writing requires the current community rules, and asks again after a change', (t) => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const { id: accountId } = database.findOrCreateAccount('writer-phone');
  const version1 = { privacy: 'p-1', community: 'c-1' };
  const stories = createStoryService({ database, policyVersions: version1 });
  const consents = createConsentService({ database, policyVersions: version1 });

  assert.throws(
    () => stories.createStory({ accountId, input: STORY }),
    { code: 'community-consent-required', status: 403 }
  );
  assert.throws(
    () => consents.accept({ accountId, policy: 'community', version: 'c-0' }),
    { code: 'policy-version-outdated', status: 409 }
  );
  assert.throws(() => consents.accept({ accountId, policy: 'terms', version: 'c-1' }), { code: 'invalid-policy' });
  assert.equal(consents.accept({ accountId, policy: 'community', version: 'c-1' }).community.accepted, true);
  assert.equal(stories.createStory({ accountId, input: STORY }).moderationStatus, 'pending-human-review');

  // A material change bumps the version: earlier agreement no longer counts.
  const version2 = { privacy: 'p-1', community: 'c-2' };
  const storiesAfterChange = createStoryService({ database, policyVersions: version2 });
  const consentsAfterChange = createConsentService({ database, policyVersions: version2 });
  assert.equal(consentsAfterChange.status(accountId).community.accepted, false);
  assert.throws(
    () => storiesAfterChange.createStory({ accountId, input: STORY }),
    { code: 'community-consent-required' }
  );
  consentsAfterChange.accept({ accountId, policy: 'community', version: 'c-2' });
  assert.equal(storiesAfterChange.createStory({ accountId, input: STORY }).title, 'Before I write');
  assert.equal(database.hasConsent(accountId, 'community', 'c-1'), true, 'earlier agreements stay on record');
});
