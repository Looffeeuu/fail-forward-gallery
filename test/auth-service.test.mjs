import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthService } from '../server/auth-service.mjs';
import { createDatabase } from '../server/database.mjs';

function createFixture(options = {}) {
  const database = createDatabase(':memory:');
  const sentMessages = [];
  let timestamp = Date.parse('2026-09-15T00:00:00.000Z');
  let tokenCounter = 0;
  const authService = createAuthService({
    database,
    smsProvider: {
      async sendVerificationCode(message) {
        sentMessages.push(message);
      }
    },
    secret: 'test-secret-that-is-long-enough-for-authentication',
    developmentModeratorPhone: options.developmentModeratorPhone || '',
    verificationCooldownMs: 5_000,
    now: () => new Date(timestamp),
    generateCode: () => '314159',
    generateToken: () => `test-token-${tokenCounter += 1}`
  });

  return {
    authService,
    database,
    sentMessages,
    advance(milliseconds) {
      timestamp += milliseconds;
    }
  };
}

test('mobile verification creates a private session without exposing a phone number', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.database.close());

  const requestResult = await fixture.authService.requestCode({
    phone: '138 0013 8000',
    ip: '127.0.0.1'
  });

  assert.equal(requestResult.status, 'accepted');
  assert.equal(requestResult.phoneHint, '******8000');
  assert.equal(fixture.sentMessages[0].phone, '+8613800138000');
  assert.equal(fixture.sentMessages[0].code, '314159');
  assert.equal('phone' in requestResult, false);
  assert.equal('code' in requestResult, false);

  assert.throws(
    () => fixture.authService.verifyCode({ phone: '13800138000', code: '000000' }),
    (error) => error.code === 'invalid-code'
  );

  const verified = fixture.authService.verifyCode({
    phone: '13800138000',
    code: '314159'
  });

  assert.deepEqual(verified.account, { role: 'member', status: 'active' });
  assert.equal('id' in verified.account, false);
  assert.deepEqual(
    fixture.authService.restoreSession(verified.sessionToken),
    { role: 'member', status: 'active' }
  );
  const privateSession = fixture.authService.resolveSession(verified.sessionToken);
  assert.ok(privateSession.accountId);
  assert.equal('accountId' in fixture.authService.restoreSession(verified.sessionToken), false);

  fixture.authService.signOut(verified.sessionToken);
  assert.equal(fixture.authService.restoreSession(verified.sessionToken), null);
});

test('development moderator bootstrap assigns only the configured phone', async (t) => {
  const fixture = createFixture({ developmentModeratorPhone: '13600136000' });
  t.after(() => fixture.database.close());

  await fixture.authService.requestCode({
    phone: '13600136000',
    ip: '127.0.0.1'
  });
  const verified = fixture.authService.verifyCode({
    phone: '13600136000',
    code: '314159'
  });

  assert.deepEqual(verified.account, { role: 'moderator', status: 'active' });
  assert.equal('accountId' in verified.account, false);
});

test('verification requests validate phone numbers, expire, and rate-limit repeats', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.database.close());

  await assert.rejects(
    fixture.authService.requestCode({ phone: '12345', ip: '127.0.0.1' }),
    (error) => error.code === 'invalid-phone'
  );

  await fixture.authService.requestCode({ phone: '13900139000', ip: '127.0.0.1' });
  await assert.rejects(
    fixture.authService.requestCode({ phone: '13900139000', ip: '127.0.0.1' }),
    (error) => error.code === 'rate-limited' && error.retryAfterSeconds > 0
  );

  fixture.advance(5 * 60 * 1000 + 1);
  assert.throws(
    () => fixture.authService.verifyCode({ phone: '13900139000', code: '314159' }),
    (error) => error.code === 'code-expired'
  );
});

test('one number gets at most 5 codes an hour and 10 a day, from any network', async () => {
  const database = createDatabase(':memory:');
  let time = new Date('2026-10-20T00:00:00.000Z').getTime();
  let sent = 0;
  const auth = createAuthService({
    database,
    smsProvider: { async sendVerificationCode() { sent += 1; } },
    secret: 'sms-cap-test-secret-that-is-long-enough',
    verificationCooldownMs: 60 * 1000,
    maxRequestsPerIpWindow: 1000,
    now: () => new Date(time)
  });
  const request = (ip) => auth.requestCode({ phone: '13800138000', ip });

  for (let index = 0; index < 5; index += 1) {
    await request(`198.51.100.${index}`);
    time += 61 * 1000;
  }
  await assert.rejects(request('203.0.113.7'), (error) => (
    error.code === 'rate-limited' && error.retryAfterSeconds > 0
  ));

  // Spread over the day, the daily cap still applies.
  for (let hour = 0; hour < 3; hour += 1) {
    time += 60 * 60 * 1000;
    for (let index = 0; index < 5 && sent < 10; index += 1) {
      await request(`192.0.2.${hour}${index}`);
      time += 61 * 1000;
    }
  }
  assert.equal(sent, 10);
  time += 60 * 60 * 1000;
  await assert.rejects(request('192.0.2.200'), { code: 'rate-limited' });
  time += 24 * 60 * 60 * 1000;
  await request('192.0.2.201');
  assert.equal(sent, 11, 'a new day allows codes again');
  database.close();
});
