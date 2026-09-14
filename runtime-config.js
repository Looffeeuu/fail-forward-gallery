'use strict';

// Safe public runtime configuration. Deployment-specific values may replace
// this file, but secrets must never be added here or shipped to the browser.
window.FFG_RUNTIME_CONFIG = Object.freeze({
  environment: 'development',
  auth: Object.freeze({
    enabled: false,
    baseUrl: '',
    requestTimeoutMs: 10000
  })
});
