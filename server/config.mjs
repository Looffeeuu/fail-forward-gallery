import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(serverDirectory, '..');
const environment = process.env.NODE_ENV || 'development';
const isProduction = environment === 'production';
const runsFromWindowsSharedPath = process.platform === 'win32' && projectRoot.startsWith('\\\\');
const defaultDataDirectory = runsFromWindowsSharedPath
  ? join(tmpdir(), 'fail-forward-gallery')
  : join(projectRoot, '.data');
const dataDirectory = resolve(process.env.FFG_DATA_DIR || defaultDataDirectory);
const developmentModeratorPhone = String(
  process.env.FFG_DEV_MODERATOR_PHONE || ''
).trim();
if (isProduction && developmentModeratorPhone) {
  throw new Error('FFG_DEV_MODERATOR_PHONE is available only in development.');
}

function loadAuthenticationSecret() {
  const configuredSecret = String(process.env.FFG_AUTH_SECRET || '').trim();
  if (configuredSecret) {
    if (configuredSecret.length < 32) {
      throw new Error('FFG_AUTH_SECRET must contain at least 32 characters.');
    }
    return configuredSecret;
  }

  if (isProduction) {
    throw new Error('FFG_AUTH_SECRET is required in production.');
  }

  mkdirSync(dataDirectory, { recursive: true });
  const secretPath = join(dataDirectory, 'development-auth-secret');
  if (existsSync(secretPath)) return readFileSync(secretPath, 'utf8').trim();

  const generatedSecret = randomBytes(48).toString('base64url');
  writeFileSync(secretPath, generatedSecret, { encoding: 'utf8', mode: 0o600 });
  return generatedSecret;
}

const port = Number.parseInt(process.env.PORT || '4173', 10);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

export const config = Object.freeze({
  environment,
  isProduction,
  projectRoot,
  dataDirectory,
  databasePath: resolve(process.env.FFG_DATABASE_PATH || join(dataDirectory, 'ffg.sqlite')),
  host: process.env.HOST || '127.0.0.1',
  port,
  authSecret: loadAuthenticationSecret(),
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  verificationTtlMs: 5 * 60 * 1000,
  verificationCooldownMs: isProduction ? 60 * 1000 : 5 * 1000,
  smsProvider: process.env.FFG_SMS_PROVIDER || 'development',
  developmentModeratorPhone
});
