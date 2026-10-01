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
    body: JSON.stringify({ phone, code: '314159' })
  });
  updateCookieJar(jar, response.headers);
  return response.json();
}

async function submitStory(baseUrl, jar, csrfToken, title) {
  const response = await fetch(`${baseUrl}/api/v1/stories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(jar),
      'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
      title,
      board: 'academic',
      content: '失'.repeat(150),
      responsePreference: 'none',
      tags: ['ExamFailure'],
      guidelinesAccepted: true
    })
  });
  assert.equal(response.status, 201);
  return (await response.json()).story;
}

test('moderation API enforces reviewer access and publishes only approved stories', async (t) => {
  const database = createDatabase(':memory:');
  const authService = createAuthService({
    database,
    smsProvider: { async sendVerificationCode() {} },
    secret: 'moderation-api-test-secret-that-is-long-enough',
    verificationCooldownMs: 0,
    developmentModeratorPhone: '13900139000',
    generateCode: () => '314159'
  });
  let storyCounter = 0;
  const storyService = createStoryService({
    database,
    generateId: () => `moderation-api-story-${storyCounter += 1}`
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
  const authorJar = new Map();
  const moderatorJar = new Map();

  t.after(async () => {
    await new Promise((done) => server.close(done));
    database.close();
  });

  await signIn(baseUrl, authorJar, '13800138000');
  const authorSession = await openSession(baseUrl, authorJar);
  const approvedCandidate = await submitStory(
    baseUrl,
    authorJar,
    authorSession.csrfToken,
    'A story that can be published'
  );
  const rejectedCandidate = await submitStory(
    baseUrl,
    authorJar,
    authorSession.csrfToken,
    'A story that needs privacy edits'
  );

  const memberQueue = await fetch(`${baseUrl}/api/v1/moderation/stories`, {
    headers: { Cookie: cookieHeader(authorJar) }
  });
  assert.equal(memberQueue.status, 403);

  const moderatorAccount = await signIn(baseUrl, moderatorJar, '13900139000');
  assert.equal(moderatorAccount.account.role, 'moderator');
  const moderatorSession = await openSession(baseUrl, moderatorJar);
  const queueResponse = await fetch(`${baseUrl}/api/v1/moderation/stories`, {
    headers: { Cookie: cookieHeader(moderatorJar) }
  });
  assert.equal(queueResponse.status, 200);
  const queue = (await queueResponse.json()).stories;
  assert.equal(queue.length, 2);
  assert.equal('authorAccountId' in queue[0], false);
  assert.equal('accountId' in queue[0], false);

  const approveResponse = await fetch(
    `${baseUrl}/api/v1/moderation/stories/${approvedCandidate.id}/decision`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(moderatorJar),
        'X-CSRF-Token': moderatorSession.csrfToken
      },
      body: JSON.stringify({
        decision: 'approve',
        reason: 'Meets the privacy and community guidelines.'
      })
    }
  );
  assert.equal(approveResponse.status, 200);

  const rejectResponse = await fetch(
    `${baseUrl}/api/v1/moderation/stories/${rejectedCandidate.id}/decision`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(moderatorJar),
        'X-CSRF-Token': moderatorSession.csrfToken
      },
      body: JSON.stringify({
        decision: 'reject',
        reason: 'Remove identifying details before submitting again.'
      })
    }
  );
  assert.equal(rejectResponse.status, 200);

  const publicResponse = await fetch(`${baseUrl}/api/v1/stories`);
  const publicStories = (await publicResponse.json()).stories;
  assert.deepEqual(publicStories.map(({ id }) => id), [approvedCandidate.id]);
  assert.equal('decisionReason' in publicStories[0], false);
  assert.equal('humanReviewStatus' in publicStories[0], false);

  const ownerResponse = await fetch(`${baseUrl}/api/v1/me/stories`, {
    headers: { Cookie: cookieHeader(authorJar) }
  });
  const ownerStories = (await ownerResponse.json()).stories;
  assert.equal(
    ownerStories.find(({ id }) => id === rejectedCandidate.id).decisionReason,
    'Remove identifying details before submitting again.'
  );

  const repeatedDecision = await fetch(
    `${baseUrl}/api/v1/moderation/stories/${approvedCandidate.id}/decision`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(moderatorJar),
        'X-CSRF-Token': moderatorSession.csrfToken
      },
      body: JSON.stringify({
        decision: 'reject',
        reason: 'A completed decision cannot be changed here.'
      })
    }
  );
  assert.equal(repeatedDecision.status, 409);
});
