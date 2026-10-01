function maskPhone(phone) {
  return `+86 ******${String(phone).slice(-4)}`;
}

export function createDevelopmentSmsProvider({ logger = console } = {}) {
  return Object.freeze({
    name: 'development-terminal',

    async sendVerificationCode({ phone, code, expiresInSeconds }) {
      logger.info(
        `[开发短信 / DEV SMS] ${maskPhone(phone)} 验证码: ${code}（${expiresInSeconds}秒内有效）`
      );
    }
  });
}

export function createSmsProvider({ providerName, isProduction, logger = console }) {
  if (providerName === 'development' && !isProduction) {
    return createDevelopmentSmsProvider({ logger });
  }

  if (providerName === 'development' && isProduction) {
    throw new Error('The development SMS provider cannot run in production.');
  }

  // Production providers are intentionally server-only adapters. A Tencent
  // Cloud implementation will be added after the SMS signature and template
  // qualifications are approved; credentials must never enter browser code.
  throw new Error(`Unsupported SMS provider: ${providerName}`);
}
