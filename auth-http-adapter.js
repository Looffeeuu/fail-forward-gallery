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
    'review-conflict'
  ]);

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
      decidedAt: story.decidedAt ? String(story.decidedAt) : null
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
      publishedAt: story.publishedAt ? String(story.publishedAt) : null
    });
  }

  function createHttpAuthAdapter(options = {}) {
    const fetchImpl = options.fetchImpl || window.fetch.bind(window);
    const baseUrl = normaliseBaseUrl(options.baseUrl);
    const timeoutMs = Number.isFinite(options.requestTimeoutMs)
      ? Math.max(1000, options.requestTimeoutMs)
      : 10000;
    let csrfToken = '';

    async function request(path, init = {}) {
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
