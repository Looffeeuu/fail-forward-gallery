import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import test from 'node:test';
import { createAccountService } from '../server/account-service.mjs';
import { createAuthService } from '../server/auth-service.mjs';
import { createAuthorControlService } from '../server/author-control-service.mjs';
import { createConsentService } from '../server/consent-service.mjs';
import { createDatabase } from '../server/database.mjs';
import { createHttpServer } from '../server/http-server.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createNotificationService } from '../server/notification-service.mjs';
import { createRankingService } from '../server/ranking-service.mjs';
import { createReportService } from '../server/report-service.mjs';
import { createStaffService } from '../server/staff-service.mjs';
import { createStoryResponseService } from '../server/story-response-service.mjs';
import { createStoryService } from '../server/story-service.mjs';
import { createSuspensionService } from '../server/suspension-service.mjs';
import { createViewService } from '../server/view-service.mjs';

function rawRequest(port, text) {
  return new Promise((done) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    let received = '';
    socket.on('data', (chunk) => { received += chunk; });
    socket.on('close', () => done(received.split('\r\n')[0]));
    socket.on('error', () => done(''));
    setTimeout(() => socket.destroy(), 1000);
  });
}

// A single malformed request used to crash the whole process (found in the
// pre-pilot audit). Each case must fail on its own while the server stays up.
test('malformed requests are rejected without stopping the server', async (t) => {
  const database = createDatabase(':memory:');
  const storyService = createStoryService({ database });
  const server = createHttpServer({
    authService: createAuthService({
      database,
      smsProvider: { async sendVerificationCode() {} },
      secret: 'robustness-test-secret-that-is-long-enough'
    }),
    storyService,
    storyResponseService: createStoryResponseService({ database }),
    authorControlService: createAuthorControlService({ database }),
    notificationService: createNotificationService({ database }),
    reportService: createReportService({ database }),
    viewService: createViewService({ database, secret: 'robustness-view-secret' }),
    rankingService: createRankingService({ database, storyService }),
    staffService: createStaffService({ database, secret: 'robustness-staff-secret' }),
    consentService: createConsentService({ database, policyVersions: { privacy: 't', community: 't' } }),
    accountService: createAccountService({
      database,
      storyService: createStoryService({ database }),
      storyResponseService: createStoryResponseService({ database })
    }),
    suspensionService: createSuspensionService({ database }),
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
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await new Promise((done) => server.close(done));
    database.close();
  });
  const healthy = async () => (await fetch(`${baseUrl}/api/v1/health`)).status === 200;

  const badCookie = await fetch(`${baseUrl}/api/v1/auth/session`, {
    headers: { Cookie: 'ffg_session=%E0%A4%A; ffg_csrf=ok' }
  });
  assert.equal(badCookie.status, 200, 'an undecodable cookie is ignored');
  assert.equal(await healthy(), true);

  assert.match(await rawRequest(port, 'GET http://[ HTTP/1.1\r\nHost: x\r\n\r\n'), / 400 /);
  assert.equal(await healthy(), true);

  const badPath = await fetch(`${baseUrl}/api/v1/stories/%E0%A4%A/views`, { method: 'POST' });
  assert.equal(badPath.status, 403, 'CSRF is still checked first');
  const badStaticPath = await fetch(`${baseUrl}/%E0%A4%A`);
  assert.equal(badStaticPath.status, 400);
  assert.equal(await healthy(), true);
});
