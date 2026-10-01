import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual
} from 'node:crypto';

export class AuthError extends Error {
  constructor(code, status, message, retryAfterSeconds = null) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function normaliseMainlandPhone(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  const nationalNumber = digits.startsWith('86') && digits.length === 13
    ? digits.slice(2)
    : digits;
  return /^1[3-9]\d{9}$/.test(nationalNumber) ? `+86${nationalNumber}` : '';
}

function publicAccount(account) {
  return Object.freeze({ role: account.role, status: account.status });
}

export function createAuthService({
  database,
  smsProvider,
  secret,
  sessionTtlMs = 30 * 24 * 60 * 60 * 1000,
  verificationTtlMs = 5 * 60 * 1000,
  verificationCooldownMs = 60 * 1000,
  maxVerificationAttempts = 5,
  maxRequestsPerIpWindow = 20,
  requestWindowMs = 10 * 60 * 1000,
  developmentModeratorPhone = '',
  now = () => new Date(),
  generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
  generateToken = () => randomBytes(32).toString('base64url')
}) {
  if (!database || !smsProvider || !secret) {
    throw new TypeError('Authentication service dependencies are incomplete.');
  }

  const challenges = new Map();
  const lastRequestByPhone = new Map();
  const requestsByIp = new Map();
  const normalisedDevelopmentModeratorPhone = developmentModeratorPhone
    ? normaliseMainlandPhone(developmentModeratorPhone)
    : '';
  if (developmentModeratorPhone && !normalisedDevelopmentModeratorPhone) {
    throw new TypeError('Development moderator phone must be a valid mainland China number.');
  }

  function fingerprintPhone(phone) {
    return createHmac('sha256', secret).update(`phone:${phone}`).digest('hex');
  }

  function digestCode(phoneFingerprint, nonce, code) {
    return createHmac('sha256', secret)
      .update(`verification:${phoneFingerprint}:${nonce}:${code}`)
      .digest();
  }

  function hashSessionToken(token) {
    return createHash('sha256').update(String(token || '')).digest('hex');
  }

  function resolvePrivateSession(sessionToken) {
    if (!sessionToken) return null;
    const timestamp = now().getTime();
    cleanExpiredState(timestamp);
    const tokenHash = hashSessionToken(sessionToken);
    const session = database.findSession(tokenHash);
    if (!session) return null;

    if (new Date(session.expiresAt).getTime() <= timestamp || session.status !== 'active') {
      database.deleteSession(tokenHash);
      return null;
    }

    return Object.freeze({
      accountId: session.accountId,
      role: session.role,
      status: session.status
    });
  }

  function cleanExpiredState(timestamp) {
    for (const [fingerprint, challenge] of challenges) {
      if (challenge.expiresAt <= timestamp) challenges.delete(fingerprint);
    }
    for (const [fingerprint, requestedAt] of lastRequestByPhone) {
      if (timestamp - requestedAt >= verificationCooldownMs) {
        lastRequestByPhone.delete(fingerprint);
      }
    }
    for (const [ip, window] of requestsByIp) {
      if (timestamp - window.startedAt >= requestWindowMs) requestsByIp.delete(ip);
    }
    database.deleteExpiredSessions(new Date(timestamp));
  }

  function consumeIpRequest(ip, timestamp) {
    const key = String(ip || 'unknown');
    const current = requestsByIp.get(key);
    const window = !current || timestamp - current.startedAt >= requestWindowMs
      ? { startedAt: timestamp, count: 0 }
      : current;

    if (window.count >= maxRequestsPerIpWindow) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((requestWindowMs - (timestamp - window.startedAt)) / 1000)
      );
      throw new AuthError(
        'rate-limited',
        429,
        'Too many verification requests. Try again later.',
        retryAfterSeconds
      );
    }

    window.count += 1;
    requestsByIp.set(key, window);
  }

  return Object.freeze({
    async requestCode({ phone, ip }) {
      const normalisedPhone = normaliseMainlandPhone(phone);
      if (!normalisedPhone) {
        throw new AuthError('invalid-phone', 400, 'Enter a valid mainland China mobile number.');
      }

      const timestamp = now().getTime();
      cleanExpiredState(timestamp);
      consumeIpRequest(ip, timestamp);

      const phoneFingerprint = fingerprintPhone(normalisedPhone);
      const lastRequest = lastRequestByPhone.get(phoneFingerprint);
      if (lastRequest !== undefined && timestamp - lastRequest < verificationCooldownMs) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((verificationCooldownMs - (timestamp - lastRequest)) / 1000)
        );
        throw new AuthError(
          'rate-limited',
          429,
          'Wait before requesting another verification code.',
          retryAfterSeconds
        );
      }

      const code = generateCode();
      if (!/^\d{6}$/.test(code)) throw new Error('The SMS provider code generator must return six digits.');

      const nonce = generateToken();
      const expiresAt = timestamp + verificationTtlMs;
      const challenge = {
        codeDigest: digestCode(phoneFingerprint, nonce, code),
        nonce,
        expiresAt,
        attemptsRemaining: maxVerificationAttempts
      };

      await smsProvider.sendVerificationCode({
        phone: normalisedPhone,
        code,
        expiresInSeconds: Math.floor(verificationTtlMs / 1000)
      });

      challenges.set(phoneFingerprint, challenge);
      lastRequestByPhone.set(phoneFingerprint, timestamp);

      return Object.freeze({
        status: 'accepted',
        expiresInSeconds: Math.floor(verificationTtlMs / 1000),
        phoneHint: `******${normalisedPhone.slice(-4)}`
      });
    },

    verifyCode({ phone, code }) {
      const normalisedPhone = normaliseMainlandPhone(phone);
      const normalisedCode = String(code || '').replace(/\s/g, '');
      if (!normalisedPhone || !/^\d{6}$/.test(normalisedCode)) {
        throw new AuthError('invalid-code', 400, 'The verification code is invalid or expired.');
      }

      const timestamp = now().getTime();
      cleanExpiredState(timestamp);
      const phoneFingerprint = fingerprintPhone(normalisedPhone);
      const challenge = challenges.get(phoneFingerprint);

      if (!challenge || challenge.expiresAt <= timestamp || challenge.attemptsRemaining <= 0) {
        challenges.delete(phoneFingerprint);
        throw new AuthError('code-expired', 400, 'The verification code is invalid or expired.');
      }

      const providedDigest = digestCode(phoneFingerprint, challenge.nonce, normalisedCode);
      if (!timingSafeEqual(challenge.codeDigest, providedDigest)) {
        challenge.attemptsRemaining -= 1;
        if (challenge.attemptsRemaining <= 0) challenges.delete(phoneFingerprint);
        throw new AuthError('invalid-code', 400, 'The verification code is invalid or expired.');
      }

      challenges.delete(phoneFingerprint);
      const initialRole = normalisedPhone === normalisedDevelopmentModeratorPhone
        ? 'moderator'
        : 'member';
      const account = database.findOrCreateAccount(
        phoneFingerprint,
        new Date(timestamp),
        initialRole
      );
      if (account.status !== 'active') {
        throw new AuthError('account-suspended', 403, 'This account cannot sign in.');
      }

      const sessionToken = generateToken();
      const expiresAt = new Date(timestamp + sessionTtlMs);
      database.createSession({
        tokenHash: hashSessionToken(sessionToken),
        accountId: account.id,
        createdAt: new Date(timestamp),
        expiresAt
      });

      return Object.freeze({
        sessionToken,
        expiresAt,
        account: publicAccount(account)
      });
    },

    restoreSession(sessionToken) {
      const session = resolvePrivateSession(sessionToken);
      return session ? publicAccount(session) : null;
    },

    // Server-side content APIs use this private account ID for ownership.
    // It must never be serialised into public story or account responses.
    resolveSession(sessionToken) {
      return resolvePrivateSession(sessionToken);
    },

    signOut(sessionToken) {
      if (sessionToken) database.deleteSession(hashSessionToken(sessionToken));
    }
  });
}
