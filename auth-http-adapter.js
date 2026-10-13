'use strict';

// V0.2 HTTP adapter for the provider-neutral authentication boundary.
// It sends credentials only when runtime-config.js explicitly enables auth.
(function createHttpAdapterModule() {
  const SAFE_ERROR_CODES = new Set([
    'invalid-phone',
    'invalid-code',
    'code-expired',
    'rate-limited',
    'account-suspended',
    'invalid-csrf',
    'request-failed',
    'verification-failed',
    'session-failed',
    'sign-out-failed',
    'network-error',
    'authentication-required',
    'invalid-title',
    'invalid-board',
    'invalid-response-preference',
    'guidelines-required',
    'invalid-tags',
    'invalid-story-length',
    'moderator-required',
    'invalid-story',
    'invalid-decision',
    'invalid-review-reason',
    'review-conflict',
    'story-not-found',
    'comments-closed',
    'invalid-comment',
    'invalid-comment-id',
    'follow-up-author-only',
    'invalid-follow-up-status',
    'invalid-visibility',
    'invalid-follow-up',
    'invalid-follow-up-id',
    'comment-rate-limited',
    'too-many-pending-comments',
    'duplicate-comment',
    'content-not-found',
    'appeal-not-available',
    'appeal-already-submitted',
    'invalid-appeal-reason',
    'invalid-appeal-explanation',
    'invalid-appeal-id'
  ]);

  const CONTENT_PATHS = Object.freeze({
    story: 'stories',
    comment: 'comments',
    follow_up: 'follow-ups'
  });

  function normaliseBaseUrl(value) {
    const baseUrl = String(value || '').trim().replace(/\/$/, '');
    if (!baseUrl) return '';

    const parsed = new URL(baseUrl, window.location.origin);
    const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !isLocalDevelopment) {
      throw new TypeError('Authentication API must use HTTPS outside local development.');
    }
    return parsed.origin === window.location.origin ? parsed.pathname.replace(/\/$/, '') : parsed.href.replace(/\/$/, '');
  }

  function createAuthError(code, message) {
    const safeCode = SAFE_ERROR_CODES.has(code) ? code : 'request-failed';
    const error = new Error(message || 'Authentication request failed.');
    error.code = safeCode;
    return error;
  }

  function sanitiseAccount(account) {
    if (!account || typeof account !== 'object') return null;
    const allowedRoles = new Set(['member', 'moderator', 'administrator']);
    const allowedStatuses = new Set(['active', 'suspended']);
    return Object.freeze({
      role: allowedRoles.has(account.role) ? account.role : 'member',
      status: allowedStatuses.has(account.status) ? account.status : 'active'
    });
  }

  function optionalString(value) {
    return value ? String(value) : null;
  }

  function sanitiseList(items, sanitise) {
    return Object.freeze(
      (Array.isArray(items) ? items : []).map(sanitise).filter((item) => Boolean(item?.id))
    );
  }

  // Shared by the author and reviewer views; public payloads use the narrower
  // sanitisers below so review notes never reach anonymous readers.
  function sanitiseComment(comment) {
    if (!comment || typeof comment !== 'object') return null;
    return Object.freeze({
      id: String(comment.id || ''),
      storyId: String(comment.storyId || ''),
      storyTitle: String(comment.storyTitle || ''),
      storyContent: String(comment.storyContent || ''),
      responseType: String(comment.responseType || ''),
      content: String(comment.content || ''),
      moderationStatus: String(comment.moderationStatus || ''),
      automatedReviewStatus: String(comment.automatedReviewStatus || ''),
      createdAt: String(comment.createdAt || ''),
      publishedAt: optionalString(comment.publishedAt),
      decisionReason: optionalString(comment.decisionReason),
      decidedAt: optionalString(comment.decidedAt),
      appealId: optionalString(comment.appealId),
      appealStatus: optionalString(comment.appealStatus),
      appealReasonCode: optionalString(comment.appealReasonCode),
      appealExplanation: optionalString(comment.appealExplanation),
      appealDecisionReason: optionalString(comment.appealDecisionReason),
      appealDecidedAt: optionalString(comment.appealDecidedAt)
    });
  }

  function sanitiseFollowUp(followUp) {
    if (!followUp || typeof followUp !== 'object') return null;
    return Object.freeze({
      id: String(followUp.id || ''),
      storyId: String(followUp.storyId || ''),
      storyTitle: String(followUp.storyTitle || ''),
      status: String(followUp.status || ''),
      content: String(followUp.content || ''),
      support: String(followUp.support || ''),
      visibility: String(followUp.visibility || ''),
      moderationStatus: String(followUp.moderationStatus || ''),
      automatedReviewStatus: String(followUp.automatedReviewStatus || ''),
      createdAt: String(followUp.createdAt || ''),
      publishedAt: optionalString(followUp.publishedAt),
      decisionReason: optionalString(followUp.decisionReason),
      decidedAt: optionalString(followUp.decidedAt),
      appealId: optionalString(followUp.appealId),
      appealStatus: optionalString(followUp.appealStatus),
      appealReasonCode: optionalString(followUp.appealReasonCode),
      appealExplanation: optionalString(followUp.appealExplanation),
      appealDecisionReason: optionalString(followUp.appealDecisionReason),
      appealDecidedAt: optionalString(followUp.appealDecidedAt)
    });
  }

  function sanitisePublishedComment(comment) {
    if (!comment || typeof comment !== 'object') return null;
    return Object.freeze({
      id: String(comment.id || ''),
      responseType: String(comment.responseType || ''),
      content: String(comment.content || ''),
      publishedAt: optionalString(comment.publishedAt)
    });
  }

  function sanitisePublishedFollowUp(followUp) {
    if (!followUp || typeof followUp !== 'object') return null;
    return Object.freeze({
      id: String(followUp.id || ''),
      status: String(followUp.status || ''),
      content: String(followUp.content || ''),
      support: String(followUp.support || ''),
      publishedAt: optionalString(followUp.publishedAt)
    });
  }

  function sanitiseStory(story) {
    if (!story || typeof story !== 'object') return null;
    return Object.freeze({
      id: String(story.id || ''),
      board: String(story.board || ''),
      title: String(story.title || ''),
      content: String(story.content || ''),
      responsePreference: String(story.responsePreference || ''),
      visibility: String(story.visibility || ''),
      moderationStatus: String(story.moderationStatus || ''),
      automatedReviewStatus: String(story.automatedReviewStatus || ''),
      humanReviewStatus: String(story.humanReviewStatus || ''),
      tags: Object.freeze(Array.isArray(story.tags) ? story.tags.map(String) : []),
      createdAt: String(story.createdAt || ''),
      updatedAt: String(story.updatedAt || ''),
      publishedAt: story.publishedAt ? String(story.publishedAt) : null,
      decisionReason: story.decisionReason ? String(story.decisionReason) : null,
      decidedAt: story.decidedAt ? String(story.decidedAt) : null,
      followUps: sanitiseList(story.followUps, sanitiseFollowUp),
      appealId: optionalString(story.appealId),
      appealStatus: optionalString(story.appealStatus),
      appealReasonCode: optionalString(story.appealReasonCode),
      appealExplanation: optionalString(story.appealExplanation),
      appealDecisionReason: optionalString(story.appealDecisionReason),
      appealDecidedAt: optionalString(story.appealDecidedAt)
    });
  }

  const OWNED_CONTENT_SANITISERS = Object.freeze({
    story: sanitiseStory,
    comment: sanitiseComment,
    follow_up: sanitiseFollowUp
  });

  // Reviewer view of an appeal: the rejected content plus the original decision.
  function sanitiseAppeal(appeal) {
    if (!appeal || typeof appeal !== 'object') return null;
    const sanitiseContent = OWNED_CONTENT_SANITISERS[appeal.contentType];
    if (!sanitiseContent) return null;
    return Object.freeze({
      id: String(appeal.id || ''),
      contentType: String(appeal.contentType),
      reasonCode: String(appeal.reasonCode || ''),
      explanation: String(appeal.explanation || ''),
      createdAt: String(appeal.createdAt || ''),
      originalDecisionReason: optionalString(appeal.originalDecisionReason),
      originalDecidedAt: optionalString(appeal.originalDecidedAt),
      originalDecisionByYou: appeal.originalDecisionByYou === true,
      content: sanitiseContent(appeal.content)
    });
  }

  function sanitisePublishedStory(story) {
    if (!story || typeof story !== 'object') return null;
    return Object.freeze({
      id: String(story.id || ''),
      board: String(story.board || ''),
      title: String(story.title || ''),
      content: String(story.content || ''),
      responsePreference: String(story.responsePreference || ''),
      tags: Object.freeze(Array.isArray(story.tags) ? story.tags.map(String) : []),
      publishedAt: story.publishedAt ? String(story.publishedAt) : null,
      comments: sanitiseList(story.comments, sanitisePublishedComment),
      followUps: sanitiseList(story.followUps, sanitisePublishedFollowUp)
    });
  }

  function createHttpAuthAdapter(options = {}) {
    const fetchImpl = options.fetchImpl || window.fetch.bind(window);
    const baseUrl = normaliseBaseUrl(options.baseUrl);
    const timeoutMs = Number.isFinite(options.requestTimeoutMs)
      ? Math.max(1000, options.requestTimeoutMs)
      : 10000;
    let csrfToken = '';

    // Another tab opening a session rotates the CSRF cookie, which would make
    // every later write from this tab fail. Fetch the current token and retry once.
    async function request(path, init = {}) {
      try {
        return await sendRequest(path, init);
      } catch (error) {
        const isWrite = init.method && init.method !== 'GET';
        if (error.code !== 'invalid-csrf' || !isWrite) throw error;
        await sendRequest('/api/v1/auth/session', { method: 'GET' });
        return sendRequest(path, init);
      }
    }

    async function sendRequest(path, init = {}) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      const headers = new Headers(init.headers || {});
      headers.set('Accept', 'application/json');
      if (init.body) headers.set('Content-Type', 'application/json');
      if (csrfToken && init.method && init.method !== 'GET') {
        headers.set('X-CSRF-Token', csrfToken);
      }

      try {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          ...init,
          headers,
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal
        });

        const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
        if (!response.ok) {
          throw createAuthError(payload.error?.code, payload.error?.message);
        }
        if (typeof payload.csrfToken === 'string') csrfToken = payload.csrfToken;
        return payload;
      } catch (error) {
        if (error.name === 'AbortError' || error instanceof TypeError) {
          throw createAuthError('network-error', 'The service could not be reached.');
        }
        throw error;
      } finally {
        window.clearTimeout(timer);
      }
    }

    return Object.freeze({
      async restoreSession() {
        const payload = await request('/api/v1/auth/session', { method: 'GET' });
        return payload.authenticated ? sanitiseAccount(payload.account) : null;
      },

      async requestPhoneCode(phone) {
        await request('/api/v1/auth/sms-code', {
          method: 'POST',
          body: JSON.stringify({ phone })
        });
      },

      async verifyPhoneCode({ phone, code }) {
        const payload = await request('/api/v1/auth/sms-code/verify', {
          method: 'POST',
          body: JSON.stringify({ phone, code })
        });
        if (!payload.account) throw createAuthError('verification-failed');
        return sanitiseAccount(payload.account);
      },

      async signOut() {
        await request('/api/v1/auth/sign-out', { method: 'POST' });
      },

      async requestJson(path, init) {
        return request(path, init);
      }
    });
  }

  function createContentApi(adapter) {
    return Object.freeze({
      enabled: true,

      async createStory(input) {
        const payload = await adapter.requestJson('/api/v1/stories', {
          method: 'POST',
          body: JSON.stringify(input)
        });
        const story = sanitiseStory(payload.story);
        if (!story?.id) throw createAuthError('request-failed', 'The story response was incomplete.');
        return story;
      },

      async listMyStories() {
        const payload = await adapter.requestJson('/api/v1/me/stories', { method: 'GET' });
        return Object.freeze(
          (Array.isArray(payload.stories) ? payload.stories : [])
            .map(sanitiseStory)
            .filter(Boolean)
        );
      },

      async listPublishedStories() {
        const payload = await adapter.requestJson('/api/v1/stories', { method: 'GET' });
        return Object.freeze(
          (Array.isArray(payload.stories) ? payload.stories : [])
            .map(sanitisePublishedStory)
            .filter((story) => Boolean(story?.id))
        );
      },

      async listModerationStories() {
        const payload = await adapter.requestJson('/api/v1/moderation/stories', { method: 'GET' });
        return Object.freeze(
          (Array.isArray(payload.stories) ? payload.stories : [])
            .map(sanitiseStory)
            .filter((story) => Boolean(story?.id))
        );
      },

      async decideStory(storyId, input) {
        const payload = await adapter.requestJson(
          `/api/v1/moderation/stories/${encodeURIComponent(storyId)}/decision`,
          {
            method: 'POST',
            body: JSON.stringify(input)
          }
        );
        const story = sanitiseStory(payload.story);
        if (!story?.id) throw createAuthError('request-failed', 'The review response was incomplete.');
        return story;
      },

      async createComment(storyId, input) {
        const payload = await adapter.requestJson(
          `/api/v1/stories/${encodeURIComponent(storyId)}/comments`,
          { method: 'POST', body: JSON.stringify(input) }
        );
        const comment = sanitiseComment(payload.comment);
        if (!comment?.id) throw createAuthError('request-failed', 'The response was incomplete.');
        return comment;
      },

      async createFollowUp(storyId, input) {
        const payload = await adapter.requestJson(
          `/api/v1/stories/${encodeURIComponent(storyId)}/follow-ups`,
          { method: 'POST', body: JSON.stringify(input) }
        );
        const followUp = sanitiseFollowUp(payload.followUp);
        if (!followUp?.id) throw createAuthError('request-failed', 'The follow-up response was incomplete.');
        return followUp;
      },

      async listMyComments() {
        const payload = await adapter.requestJson('/api/v1/me/comments', { method: 'GET' });
        return sanitiseList(payload.comments, sanitiseComment);
      },

      async withdrawContent(contentType, contentId) {
        const payload = await adapter.requestJson(
          `/api/v1/me/${CONTENT_PATHS[contentType]}/${encodeURIComponent(contentId)}/withdraw`,
          { method: 'POST' }
        );
        return OWNED_CONTENT_SANITISERS[contentType](payload.content);
      },

      async appealContent(contentType, contentId, input) {
        const payload = await adapter.requestJson(
          `/api/v1/me/${CONTENT_PATHS[contentType]}/${encodeURIComponent(contentId)}/appeal`,
          { method: 'POST', body: JSON.stringify(input) }
        );
        return OWNED_CONTENT_SANITISERS[contentType](payload.content);
      },

      async listModerationAppeals() {
        const payload = await adapter.requestJson('/api/v1/moderation/appeals', { method: 'GET' });
        return sanitiseList(payload.appeals, sanitiseAppeal);
      },

      async decideAppeal(appealId, input) {
        const payload = await adapter.requestJson(
          `/api/v1/moderation/appeals/${encodeURIComponent(appealId)}/decision`,
          { method: 'POST', body: JSON.stringify(input) }
        );
        if (!payload.appeal?.id) throw createAuthError('request-failed', 'The review response was incomplete.');
        return payload.appeal;
      },

      async listModerationComments() {
        const payload = await adapter.requestJson('/api/v1/moderation/comments', { method: 'GET' });
        return sanitiseList(payload.comments, sanitiseComment);
      },

      async listModerationFollowUps() {
        const payload = await adapter.requestJson('/api/v1/moderation/follow-ups', { method: 'GET' });
        return sanitiseList(payload.followUps, sanitiseFollowUp);
      },

      async decideComment(commentId, input) {
        const payload = await adapter.requestJson(
          `/api/v1/moderation/comments/${encodeURIComponent(commentId)}/decision`,
          { method: 'POST', body: JSON.stringify(input) }
        );
        const comment = sanitiseComment(payload.comment);
        if (!comment?.id) throw createAuthError('request-failed', 'The review response was incomplete.');
        return comment;
      },

      async decideFollowUp(followUpId, input) {
        const payload = await adapter.requestJson(
          `/api/v1/moderation/follow-ups/${encodeURIComponent(followUpId)}/decision`,
          { method: 'POST', body: JSON.stringify(input) }
        );
        const followUp = sanitiseFollowUp(payload.followUp);
        if (!followUp?.id) throw createAuthError('request-failed', 'The review response was incomplete.');
        return followUp;
      }
    });
  }

  function initAuthService() {
    const config = window.FFG_RUNTIME_CONFIG?.auth;
    if (!config?.enabled || !window.FFG_AUTH) return;

    try {
      const adapter = createHttpAuthAdapter(config);
      window.FFG_CONTENT_API = createContentApi(adapter);
      window.FFG_AUTH.configure(adapter);
      window.FFG_AUTH.restoreSession().catch(() => {});
    } catch (error) {
      console.error('Authentication configuration is invalid.');
    }
  }

  window.FFG_CREATE_HTTP_AUTH_ADAPTER = createHttpAuthAdapter;
  window.FFG_CONTENT_API = Object.freeze({ enabled: false });
  window.initAuthService = initAuthService;
})();
