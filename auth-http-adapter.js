'use strict';

// V0.2 HTTP adapter for the provider-neutral authentication boundary.
// It sends credentials only when runtime-config.js explicitly enables auth.
(function createHttpAdapterModule() {
  const SAFE_ERROR_CODES = new Set([
    'invalid-email',
    'invalid-code',
    'code-expired',
    'rate-limited',
    'account-suspended',
    'request-failed',
    'verification-failed',
    'session-failed',
    'sign-out-failed',
    'network-error'
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
          throw createAuthError('network-error', 'Authentication service could not be reached.');
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

      async requestEmailCode(email) {
        await request('/api/v1/auth/email-code', {
          method: 'POST',
          body: JSON.stringify({ email })
        });
      },

      async verifyEmailCode({ email, code }) {
        const payload = await request('/api/v1/auth/email-code/verify', {
          method: 'POST',
          body: JSON.stringify({ email, code })
        });
        if (!payload.account) throw createAuthError('verification-failed');
        return sanitiseAccount(payload.account);
      },

      async signOut() {
        await request('/api/v1/auth/sign-out', { method: 'POST' });
        csrfToken = '';
      }
    });
  }

  function initAuthService() {
    const config = window.FFG_RUNTIME_CONFIG?.auth;
    if (!config?.enabled || !window.FFG_AUTH) return;

    try {
      const adapter = createHttpAuthAdapter(config);
      window.FFG_AUTH.configure(adapter);
      window.FFG_AUTH.restoreSession().catch(() => {});
    } catch (error) {
      console.error('Authentication configuration is invalid.');
    }
  }

  window.FFG_CREATE_HTTP_AUTH_ADAPTER = createHttpAuthAdapter;
  window.initAuthService = initAuthService;
})();
