import { createServer as createNodeServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { AuthError } from './auth-service.mjs';
import { ModerationError } from './moderation-service.mjs';
import { StoryError } from './story-service.mjs';

const MAX_JSON_BYTES = 8 * 1024;
const CSRF_COOKIE = 'ffg_csrf';
const SESSION_COOKIE = 'ffg_session';
const PUBLIC_FILES = new Set([
  'index.html',
  'styles.css',
  'app.js',
  'data.js',
  'i18n.js',
  'runtime-config.js',
  'auth.js',
  'auth-http-adapter.js'
]);

const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
});

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, part) => {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) return cookies;
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function cookie(name, value, { maxAge, secure, sameSite = 'Strict' } = {}) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`
  ];
  if (Number.isFinite(maxAge)) attributes.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function clearCookie(name, secure) {
  return cookie(name, '', { maxAge: 0, secure });
}

function securityHeaders(isProduction) {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'none'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self'"
    ].join('; '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  };
  if (isProduction) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function sendJson(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  });
  response.end(body);
}

async function readJson(request) {
  const declaredLength = Number.parseInt(request.headers['content-length'] || '0', 10);
  if (declaredLength > MAX_JSON_BYTES) {
    throw new AuthError('request-too-large', 413, 'The request body is too large.');
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_BYTES) {
      throw new AuthError('request-too-large', 413, 'The request body is too large.');
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new AuthError('invalid-request', 400, 'A valid JSON request body is required.');
  }
}

function createCsrfToken() {
  return randomBytes(24).toString('base64url');
}

function csrfMatches(request, cookies) {
  const headerToken = String(request.headers['x-csrf-token'] || '');
  const cookieToken = String(cookies[CSRF_COOKIE] || '');
  if (!headerToken || headerToken.length !== cookieToken.length) return false;
  return timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));
}

function requireCsrf(request, cookies) {
  if (!csrfMatches(request, cookies)) {
    throw new AuthError('invalid-csrf', 403, 'Refresh the page and try again.');
  }
}

function clientIp(request) {
  return request.socket.remoteAddress || 'unknown';
}

function runtimeConfigSource(environment) {
  return `'use strict';\nwindow.FFG_RUNTIME_CONFIG = Object.freeze({\n  environment: ${JSON.stringify(environment)},\n  market: 'CN',\n  auth: Object.freeze({ enabled: true, baseUrl: '', requestTimeoutMs: 10000 })\n});\n`;
}

async function serveStatic(request, response, { projectRoot, environment }) {
  const url = new URL(request.url, 'http://localhost');
  let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';

  if (relativePath === 'runtime-config.js') {
    const body = runtimeConfigSource(environment);
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    });
    if (request.method === 'HEAD') return response.end();
    return response.end(body);
  }

  const isAsset = relativePath.startsWith('assets/');
  if (!PUBLIC_FILES.has(relativePath) && !isAsset) {
    sendJson(response, 404, { error: { code: 'not-found', message: 'Resource not found.' } });
    return;
  }

  const absolutePath = resolve(projectRoot, relativePath);
  if (absolutePath !== projectRoot && !absolutePath.startsWith(`${projectRoot}${sep}`)) {
    sendJson(response, 404, { error: { code: 'not-found', message: 'Resource not found.' } });
    return;
  }

  try {
    const body = await readFile(absolutePath);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(absolutePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length
    });
    if (request.method === 'HEAD') return response.end();
    response.end(body);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendJson(response, 404, { error: { code: 'not-found', message: 'Resource not found.' } });
      return;
    }
    throw error;
  }
}

export function createHttpServer({
  authService,
  storyService,
  moderationService,
  config,
  logger = console
}) {
  if (!authService || !storyService || !moderationService || !config) {
    throw new TypeError('HTTP server dependencies are incomplete.');
  }

  return createNodeServer(async (request, response) => {
    Object.entries(securityHeaders(config.isProduction)).forEach(([name, value]) => {
      response.setHeader(name, value);
    });

    const url = new URL(request.url, 'http://localhost');
    const cookies = parseCookies(request.headers.cookie);

    try {
      if (request.method === 'GET' && url.pathname === '/api/v1/health') {
        sendJson(response, 200, {
          status: 'ok',
          service: 'fail-forward-gallery',
          version: '0.2.0'
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/auth/session') {
        const account = authService.restoreSession(cookies[SESSION_COOKIE]);
        const csrfToken = createCsrfToken();
        response.setHeader('Set-Cookie', cookie(CSRF_COOKIE, csrfToken, {
          maxAge: 2 * 60 * 60,
          secure: config.isProduction
        }));
        sendJson(response, 200, {
          authenticated: Boolean(account),
          ...(account ? { account } : {}),
          csrfToken
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/auth/sms-code') {
        requireCsrf(request, cookies);
        const body = await readJson(request);
        const result = await authService.requestCode({ phone: body.phone, ip: clientIp(request) });
        sendJson(response, 202, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/auth/sms-code/verify') {
        requireCsrf(request, cookies);
        const body = await readJson(request);
        const result = authService.verifyCode({ phone: body.phone, code: body.code });
        const csrfToken = createCsrfToken();
        response.setHeader('Set-Cookie', [
          cookie(SESSION_COOKIE, result.sessionToken, {
            maxAge: Math.floor(config.sessionTtlMs / 1000),
            secure: config.isProduction
          }),
          cookie(CSRF_COOKIE, csrfToken, {
            maxAge: 2 * 60 * 60,
            secure: config.isProduction
          })
        ]);
        sendJson(response, 200, { account: result.account, csrfToken });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/auth/sign-out') {
        requireCsrf(request, cookies);
        authService.signOut(cookies[SESSION_COOKIE]);
        const csrfToken = createCsrfToken();
        response.setHeader('Set-Cookie', [
          clearCookie(SESSION_COOKIE, config.isProduction),
          cookie(CSRF_COOKIE, csrfToken, {
            maxAge: 2 * 60 * 60,
            secure: config.isProduction
          })
        ]);
        sendJson(response, 200, { csrfToken });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/stories') {
        requireCsrf(request, cookies);
        const session = authService.resolveSession(cookies[SESSION_COOKIE]);
        if (!session) {
          throw new StoryError('authentication-required', 401, 'Sign in before submitting a story.');
        }
        const body = await readJson(request);
        const story = storyService.createStory({
          accountId: session.accountId,
          input: body
        });
        sendJson(response, 201, { story });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/stories') {
        sendJson(response, 200, {
          stories: storyService.listPublishedStories(100)
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/me/stories') {
        const session = authService.resolveSession(cookies[SESSION_COOKIE]);
        if (!session) {
          throw new StoryError('authentication-required', 401, 'Sign in to view your stories.');
        }
        sendJson(response, 200, {
          stories: storyService.listMyStories(session.accountId)
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/moderation/stories') {
        const session = authService.resolveSession(cookies[SESSION_COOKIE]);
        sendJson(response, 200, {
          stories: moderationService.listPendingStories(session)
        });
        return;
      }

      const decisionMatch = url.pathname.match(
        /^\/api\/v1\/moderation\/stories\/([^/]+)\/decision$/
      );
      if (request.method === 'POST' && decisionMatch) {
        requireCsrf(request, cookies);
        const session = authService.resolveSession(cookies[SESSION_COOKIE]);
        const body = await readJson(request);
        const story = moderationService.decideStory({
          session,
          storyId: decodeURIComponent(decisionMatch[1]),
          input: body
        });
        sendJson(response, 200, { story });
        return;
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        await serveStatic(request, response, config);
        return;
      }

      sendJson(response, 404, { error: { code: 'not-found', message: 'Resource not found.' } });
    } catch (error) {
      if (
        error instanceof AuthError
        || error instanceof StoryError
        || error instanceof ModerationError
      ) {
        const headers = error.retryAfterSeconds
          ? { 'Retry-After': String(error.retryAfterSeconds) }
          : {};
        sendJson(response, error.status, {
          error: { code: error.code, message: error.message }
        }, headers);
        return;
      }

      logger.error('Unhandled request error', {
        method: request.method,
        path: url.pathname,
        error: error?.message
      });
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: { code: 'internal-error', message: 'The service is temporarily unavailable.' }
        });
      } else {
        response.destroy();
      }
    }
  });
}
