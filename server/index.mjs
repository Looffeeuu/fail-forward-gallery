import { createAuthService } from './auth-service.mjs';
import { config } from './config.mjs';
import { createDatabase } from './database.mjs';
import { createHttpServer } from './http-server.mjs';
import { createModerationService } from './moderation-service.mjs';
import { createSmsProvider } from './sms-provider.mjs';
import { createStoryService } from './story-service.mjs';

const database = createDatabase(config.databasePath);
const smsProvider = createSmsProvider({
  providerName: config.smsProvider,
  isProduction: config.isProduction
});
const authService = createAuthService({
  database,
  smsProvider,
  secret: config.authSecret,
  sessionTtlMs: config.sessionTtlMs,
  verificationTtlMs: config.verificationTtlMs,
  verificationCooldownMs: config.verificationCooldownMs,
  developmentModeratorPhone: config.developmentModeratorPhone
});
const storyService = createStoryService({ database });
const moderationService = createModerationService({ database });
const server = createHttpServer({
  authService,
  storyService,
  moderationService,
  config
});

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  console.info(`Fail Forward Gallery V0.2 running at http://${config.host}:${port}`);
  if (!config.isProduction) {
    console.info('Development SMS codes appear only in this terminal.');
  }
});

function shutdown(signal) {
  console.info(`${signal} received, shutting down.`);
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
