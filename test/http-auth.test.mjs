import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { createAuthService } from '../server/auth-service.mjs';
import { createDatabase } from '../server/database.mjs';
import { createHttpServer } from '../server/http-server.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createStoryService } from '../server/story-service.mjs';

function updateCookieJar(jar, headers) {
  const setCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean);
  setCookies.forEach((setCookie) => {
    const [pair] = setCookie.split(';');
    const separatorIndex = pair.indexOf('=');
    const name = pair.slice(0, separatorIndex);
    const value = pair.slice(separatorIndex + 1);
    if (value) jar.set(name, value);
    else jar.delete(name);
  });
}

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

test('HTTP authentication flow uses CSRF and HttpOnly session cookies', async (t) => {
  const database = createDatabase(':memory:');
  const sentMessages = [];
  const authService = createAuthService({
    database,
    smsProvider: {
      async sendVerificationCode(message) {
        sentMessages.push(message);
      }
    },
    secret: 'http-test-secret-that-is-long-enough-for-auth',
    verificationCooldownMs: 0,
    generateCode: () => '271828'
  });
  const server = createHttpServer({
    authService,
    storyService: createStoryService({ database }),
    moderationService: createModerationService({ database }),
    config: {
      environment: 'test',
      isProduction: false,
      projectRoot: resolve('.'),
      sessionTtlMs: 60 * 60 * 1000
    },
    logger: { error() {} }
  });

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const cookies = new Map();

  t.after(async () => {
    await new Promise((resolveClose) => server.close(resolveClose));
    database.close();
  });

  const initialSession = await fetch(`${baseUrl}/api/v1/auth/session`);
  updateCookieJar(cookies, initialSession.headers);
  const initialPayload = await initialSession.json();
  assert.equal(initialPayload.authenticated, false);
  assert.ok(initialPayload.csrfToken);

  const missingCsrf = await fetch(`${baseUrl}/api/v1/auth/sms-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '13800138000' })
  });
  assert.equal(missingCsrf.status, 403);

  const codeRequest = await fetch(`${baseUrl}/api/v1/auth/sms-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader(cookies),
      'X-CSRF-Token': initialPayload.csrfToken
    },
    body: JSON.stringify({ phone: '13800138000' })
  });
  assert.equal(codeRequest.status, 202);
  const codePayload = await codeRequest.json();
  assert.equal(codePayload.code, undefined);
  assert.equal(sentMessages[0].code, '271828');

  const verification = await fetch(`${baseUrl}/api/v1/auth/sms-code/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader(cookies),
      'X-CSRF-Token': initialPayload.csrfToken
    },
    body: JSON.stringify({ phone: '13800138000', code: '271828' })
  });
  assert.equal(verification.status, 200);
  updateCookieJar(cookies, verification.headers);
  const verifiedPayload = await verification.json();
  assert.deepEqual(verifiedPayload.account, { role: 'member', status: 'active' });
  assert.match(verification.headers.get('set-cookie'), /HttpOnly/);

  const restored = await fetch(`${baseUrl}/api/v1/auth/session`, {
    headers: { 'Cookie': cookieHeader(cookies) }
  });
  updateCookieJar(cookies, restored.headers);
  const restoredPayload = await restored.json();
  assert.equal(restoredPayload.authenticated, true);

  const signedOut = await fetch(`${baseUrl}/api/v1/auth/sign-out`, {
    method: 'POST',
    headers: {
      'Cookie': cookieHeader(cookies),
      'X-CSRF-Token': restoredPayload.csrfToken
    }
  });
  assert.equal(signedOut.status, 200);
  updateCookieJar(cookies, signedOut.headers);

  const afterSignOut = await fetch(`${baseUrl}/api/v1/auth/session`, {
    headers: { 'Cookie': cookieHeader(cookies) }
  });
  assert.equal((await afterSignOut.json()).authenticated, false);
});
