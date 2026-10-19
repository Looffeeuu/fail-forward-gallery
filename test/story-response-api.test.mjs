import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { createAuthService } from '../server/auth-service.mjs';
import { createAuthorControlService } from '../server/author-control-service.mjs';
import { createDatabase } from '../server/database.mjs';
import { createHttpServer } from '../server/http-server.mjs';
import { createModerationService } from '../server/moderation-service.mjs';
import { createNotificationService } from '../server/notification-service.mjs';
import { createRankingService } from '../server/ranking-service.mjs';
import { createReportService } from '../server/report-service.mjs';
import { createStoryResponseService } from '../server/story-response-service.mjs';
import { createStoryService } from '../server/story-service.mjs';
import { createViewService } from '../server/view-service.mjs';

function updateCookieJar(jar, headers) {
  headers.getSetCookie().forEach((setCookie) => {
    const [pair] = setCookie.split(';');
    const separatorIndex = pair.indexOf('=');
    const value = pair.slice(separatorIndex + 1);
    if (value) jar.set(pair.slice(0, separatorIndex), value);
    else jar.delete(pair.slice(0, separatorIndex));
  });
}

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

function createClient(baseUrl) {
  const jar = new Map();
  let csrfToken = '';

  async function send(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Cookie: cookieHeader(jar),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(method === 'GET' ? {} : { 'X-CSRF-Token': csrfToken })
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    updateCookieJar(jar, response.headers);
    const payload = await response.json();
    if (typeof payload.csrfToken === 'string') csrfToken = payload.csrfToken;
    return { status: response.status, payload };
  }

  return {
    send,
    async signIn(phone) {
      await send('/api/v1/auth/session');
      await send('/api/v1/auth/sms-code', { method: 'POST', body: { phone } });
      return send('/api/v1/auth/sms-code/verify', {
        method: 'POST',
        body: { phone, code: '314159' }
      });
    }
  };
}

test('story response API enforces ownership, boundaries, and human review', async (t) => {
  const database = createDatabase(':memory:');
  const authService = createAuthService({
    database,
    smsProvider: { async sendVerificationCode() {} },
    secret: 'story-response-api-test-secret-that-is-long-enough',
    verificationCooldownMs: 0,
    developmentModeratorPhone: '13900139000',
    generateCode: () => '314159'
  });
  const server = createHttpServer({
    authService,
    storyService: createStoryService({ database }),
    storyResponseService: createStoryResponseService({ database }),
    authorControlService: createAuthorControlService({ database }),
    notificationService: createNotificationService({ database }),
    reportService: createReportService({ database }),
    viewService: createViewService({ database, secret: 'test-view-secret' }),
    rankingService: createRankingService({ database, storyService: createStoryService({ database }) }),
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
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((done) => server.close(done));
    database.close();
  });

  const author = createClient(baseUrl);
  const reader = createClient(baseUrl);
  const moderator = createClient(baseUrl);
  const visitor = createClient(baseUrl);
  await author.signIn('13800138000');
  await reader.signIn('13700137000');
  await moderator.signIn('13900139000');
  await visitor.send('/api/v1/auth/session');

  const { payload: { story } } = await author.send('/api/v1/stories', {
    method: 'POST',
    body: {
      title: 'Still finding my way',
      board: 'job',
      content: '失'.repeat(150),
      responsePreference: 'similar',
      tags: [],
      guidelinesAccepted: true
    }
  });
  const decideStory = await moderator.send(`/api/v1/moderation/stories/${story.id}/decision`, {
    method: 'POST',
    body: { decision: 'approve', reason: 'Meets the community guidelines.' }
  });
  assert.equal(decideStory.status, 200);

  const anonymousComment = await visitor.send(`/api/v1/stories/${story.id}/comments`, {
    method: 'POST',
    body: { content: 'Me too.' }
  });
  assert.equal(anonymousComment.status, 401);

  const comment = await reader.send(`/api/v1/stories/${story.id}/comments`, {
    method: 'POST',
    body: { content: 'I went through something similar last spring.' }
  });
  assert.equal(comment.status, 201);
  assert.equal(comment.payload.comment.responseType, 'similar');

  const readerFollowUp = await reader.send(`/api/v1/stories/${story.id}/follow-ups`, {
    method: 'POST',
    body: { status: 'small-steps', visibility: 'anonymous-public' }
  });
  assert.equal(readerFollowUp.status, 403);
  assert.equal(readerFollowUp.payload.error.code, 'follow-up-author-only');

  const followUp = await author.send(`/api/v1/stories/${story.id}/follow-ups`, {
    method: 'POST',
    body: {
      status: 'better-than-before',
      content: 'I found a part-time role.',
      visibility: 'anonymous-public'
    }
  });
  assert.equal(followUp.status, 201);

  const memberQueue = await reader.send('/api/v1/moderation/comments');
  assert.equal(memberQueue.status, 403);
  const commentQueue = await moderator.send('/api/v1/moderation/comments');
  assert.deepEqual(
    commentQueue.payload.comments.map(({ id }) => id),
    [comment.payload.comment.id]
  );
  const followUpQueue = await moderator.send('/api/v1/moderation/follow-ups');
  assert.deepEqual(
    followUpQueue.payload.followUps.map(({ id }) => id),
    [followUp.payload.followUp.id]
  );

  const beforeReview = await visitor.send('/api/v1/stories');
  assert.equal(beforeReview.payload.stories[0].comments.length, 0);
  assert.equal(beforeReview.payload.stories[0].followUps.length, 0);

  const rejectComment = await moderator.send(
    `/api/v1/moderation/comments/${comment.payload.comment.id}/decision`,
    { method: 'POST', body: { decision: 'reject', reason: 'Please remove the named workplace.' } }
  );
  assert.equal(rejectComment.status, 200);
  const approveFollowUp = await moderator.send(
    `/api/v1/moderation/follow-ups/${followUp.payload.followUp.id}/decision`,
    { method: 'POST', body: { decision: 'approve', reason: 'A valid anonymous update.' } }
  );
  assert.equal(approveFollowUp.status, 200);

  const afterReview = await visitor.send('/api/v1/stories');
  const [publicStory] = afterReview.payload.stories;
  assert.equal(publicStory.comments.length, 0);
  assert.deepEqual(Object.keys(publicStory.followUps[0]).sort(), [
    'content',
    'id',
    'publishedAt',
    'status',
    'support'
  ]);

  const myComments = await reader.send('/api/v1/me/comments');
  assert.equal(myComments.payload.comments[0].moderationStatus, 'rejected');
  assert.equal(myComments.payload.comments[0].decisionReason, 'Please remove the named workplace.');
  const visitorComments = await visitor.send('/api/v1/me/comments');
  assert.equal(visitorComments.status, 401);

  // Appeal the rejected comment, then overturn it from the appeal queue.
  const commentId = comment.payload.comment.id;
  const appeal = await reader.send(`/api/v1/me/comments/${commentId}/appeal`, {
    method: 'POST',
    body: { reasonCode: 'no-identifying-details', explanation: 'I only said a workplace, not which one.' }
  });
  assert.equal(appeal.status, 201);
  assert.equal(appeal.payload.content.appealStatus, 'pending');
  const appealQueue = await moderator.send('/api/v1/moderation/appeals');
  assert.equal(appealQueue.payload.appeals[0].originalDecisionByYou, true);
  const memberAppeals = await reader.send('/api/v1/moderation/appeals');
  assert.equal(memberAppeals.status, 403);
  const overturn = await moderator.send(
    `/api/v1/moderation/appeals/${appealQueue.payload.appeals[0].id}/decision`,
    { method: 'POST', body: { decision: 'overturn', reason: 'No workplace is identifiable.' } }
  );
  assert.equal(overturn.status, 200);
  assert.equal(overturn.payload.appeal.status, 'overturned');
  const withComment = await visitor.send('/api/v1/stories');
  assert.equal(withComment.payload.stories[0].comments.length, 1);

  // Views set an anonymous visitor cookie; rankings expose order, never figures.
  const view = await visitor.send(`/api/v1/stories/${story.id}/views`, { method: 'POST' });
  assert.equal(view.status, 202);
  assert.deepEqual(view.payload, { ok: true });
  const rankings = await visitor.send('/api/v1/rankings');
  assert.deepEqual(rankings.payload.rankings.mostReadDay, [story.id]);
  assert.equal(/count|score/i.test(JSON.stringify(rankings.payload.rankings)), false);
  const memberPick = await reader.send(`/api/v1/moderation/recommendations/${story.id}`, {
    method: 'PUT',
    body: { reason: 'I would like to feature this.' }
  });
  assert.equal(memberPick.status, 403);
  const pick = await moderator.send(`/api/v1/moderation/recommendations/${story.id}`, {
    method: 'PUT',
    body: { reason: 'A thoughtful account of a hard season.' }
  });
  assert.equal(pick.status, 200);
  const picked = await visitor.send('/api/v1/rankings');
  assert.equal(picked.payload.rankings.recommended[0].reason, 'A thoughtful account of a hard season.');

  // The safety-hold queue is for reviewers only.
  assert.equal((await reader.send('/api/v1/moderation/safety-holds')).status, 403);
  const heldQueue = await moderator.send('/api/v1/moderation/safety-holds');
  assert.deepEqual(heldQueue.payload.held, []);
  const strayRelease = await moderator.send(
    `/api/v1/moderation/safety-holds/stories/${story.id}/decision`,
    { method: 'POST', body: { decision: 'release', reason: 'Nothing is actually held here.' } }
  );
  assert.equal(strayRelease.status, 409);

  // Reports: signed-in readers only; reviewers see them grouped and decide once.
  const anonymousReport = await visitor.send(`/api/v1/stories/${story.id}/reports`, {
    method: 'POST',
    body: { reasonCode: 'spam' }
  });
  assert.equal(anonymousReport.status, 401);
  const report = await reader.send(`/api/v1/stories/${story.id}/reports`, {
    method: 'POST',
    body: { reasonCode: 'spam', details: 'Looks like an advert.' }
  });
  assert.equal(report.status, 201);
  const reported = await moderator.send('/api/v1/moderation/reports');
  assert.equal(reported.payload.reported[0].reportCount, 1);
  const keep = await moderator.send(`/api/v1/moderation/reports/stories/${story.id}/decision`, {
    method: 'POST',
    body: { decision: 'dismiss', reason: 'No advertising in the story.' }
  });
  assert.equal(keep.status, 200);
  assert.equal(keep.payload.result.status, 'kept');

  // Withdrawal: only the author's own story, and it leaves the public feed at once.
  const strangerWithdraw = await reader.send(`/api/v1/me/stories/${story.id}/withdraw`, {
    method: 'POST'
  });
  assert.equal(strangerWithdraw.status, 404);
  const withdraw = await author.send(`/api/v1/me/stories/${story.id}/withdraw`, { method: 'POST' });
  assert.equal(withdraw.status, 200);
  assert.equal(withdraw.payload.content.moderationStatus, 'withdrawn');
  const afterWithdraw = await visitor.send('/api/v1/stories');
  assert.equal(afterWithdraw.payload.stories.length, 0);
});
