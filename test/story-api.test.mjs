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

async function openSession(baseUrl, jar) {
  const response = await fetch(`${baseUrl}/api/v1/auth/session`, {
    headers: { Cookie: cookieHeader(jar) }
  });
  updateCookieJar(jar, response.headers);
  return response.json();
}

async function signIn(baseUrl, jar, phone) {
  const session = await openSession(baseUrl, jar);
  await fetch(`${baseUrl}/api/v1/auth/sms-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(jar),
      'X-CSRF-Token': session.csrfToken
    },
    body: JSON.stringify({ phone })
  });
  const response = await fetch(`${baseUrl}/api/v1/auth/sms-code/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(jar),
      'X-CSRF-Token': session.csrfToken
    },
    body: JSON.stringify({ phone, code: '161803' })
  });
  updateCookieJar(jar, response.headers);
  return response.json();
}

test('story API links submissions to the authenticated account only', async (t) => {
  const database = createDatabase(':memory:');
  const authService = createAuthService({
    database,
    smsProvider: { async sendVerificationCode() {} },
    secret: 'story-api-test-secret-that-is-long-enough',
    verificationCooldownMs: 0,
    generateCode: () => '161803'
  });
  const storyService = createStoryService({
    database,
    generateId: () => 'story-api-one'
  });
  const server = createHttpServer({
    authService,
    storyService,
    moderationService: createModerationService({ database }),
    config: {
      environment: 'test',
      isProduction: false,
      projectRoot: resolve('.'),
      sessionTtlMs: 60 * 60 * 1000
    },
    logger: { error() {} }
  });

  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const firstJar = new Map();
  const secondJar = new Map();

  t.after(async () => {
    await new Promise((done) => server.close(done));
    database.close();
  });

  const guestSession = await openSession(baseUrl, firstJar);
  const unauthenticated = await fetch(`${baseUrl}/api/v1/stories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(firstJar),
      'X-CSRF-Token': guestSession.csrfToken
    },
    body: JSON.stringify({})
  });
  assert.equal(unauthenticated.status, 401);

  await signIn(baseUrl, firstJar, '13800138000');
  const signedInSession = await openSession(baseUrl, firstJar);
  const created = await fetch(`${baseUrl}/api/v1/stories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(firstJar),
      'X-CSRF-Token': signedInSession.csrfToken
    },
    body: JSON.stringify({
      title: '我的一次真实尝试',
      board: 'job',
      content: '失'.repeat(150),
      responsePreference: 'encouragement',
      tags: ['InterviewAnxiety', 'FamilyPressure'],
      guidelinesAccepted: true,
      accountId: 'client-must-not-control-ownership'
    })
  });
  assert.equal(created.status, 201);
  const createdPayload = await created.json();
  assert.equal(createdPayload.story.moderationStatus, 'pending-human-review');
  assert.equal('accountId' in createdPayload.story, false);
  assert.equal('authorAccountId' in createdPayload.story, false);

  const mine = await fetch(`${baseUrl}/api/v1/me/stories`, {
    headers: { Cookie: cookieHeader(firstJar) }
  });
  assert.equal(mine.status, 200);
  assert.equal((await mine.json()).stories.length, 1);

  const noPendingPublicFeed = await fetch(`${baseUrl}/api/v1/stories`);
  assert.equal(noPendingPublicFeed.status, 200);
  assert.deepEqual((await noPendingPublicFeed.json()).stories, []);

  await signIn(baseUrl, secondJar, '13900139000');
  const theirs = await fetch(`${baseUrl}/api/v1/me/stories`, {
    headers: { Cookie: cookieHeader(secondJar) }
  });
  assert.equal(theirs.status, 200);
  assert.deepEqual((await theirs.json()).stories, []);
});
