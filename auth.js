'use strict';

// V0.2 authentication boundary.
// This module deliberately contains no demo account, localStorage token, or
// provider SDK. A production adapter must be configured before data is sent.
(function createAuthenticationModule() {
  const STATUS = Object.freeze({
    UNCONFIGURED: 'unconfigured',
    GUEST: 'guest',
    REQUESTING_CODE: 'requesting-code',
    CODE_SENT: 'code-sent',
    VERIFYING: 'verifying',
    AUTHENTICATED: 'authenticated',
    SIGNING_OUT: 'signing-out',
    ERROR: 'error'
  });

  const REQUIRED_ADAPTER_METHODS = [
    'restoreSession',
    'requestEmailCode',
    'verifyEmailCode',
    'signOut'
  ];

  let adapter = null;
  let state = {
    status: STATUS.UNCONFIGURED,
    account: null,
    pendingEmail: '',
    errorCode: null
  };
  const listeners = new Set();

  function snapshot() {
    return Object.freeze({
      status: state.status,
      account: state.account ? Object.freeze({ ...state.account }) : null,
      pendingEmail: state.pendingEmail,
      errorCode: state.errorCode
    });
  }

  function publish(patch) {
    state = { ...state, ...patch };
    const nextSnapshot = snapshot();
    listeners.forEach((listener) => listener(nextSnapshot));
    return nextSnapshot;
  }

  function requireAdapter() {
    if (adapter) return adapter;
    publish({ status: STATUS.UNCONFIGURED, errorCode: 'service-not-configured' });
    const error = new Error('Authentication service is not configured.');
    error.code = 'service-not-configured';
    throw error;
  }

  function configure(nextAdapter) {
    const isValid = nextAdapter && REQUIRED_ADAPTER_METHODS.every(
      (method) => typeof nextAdapter[method] === 'function'
    );
    if (!isValid) throw new TypeError('Authentication adapter is incomplete.');

    adapter = nextAdapter;
    publish({ status: STATUS.GUEST, account: null, errorCode: null });
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  async function restoreSession() {
    const service = requireAdapter();
    try {
      const account = await service.restoreSession();
      return publish({
        status: account ? STATUS.AUTHENTICATED : STATUS.GUEST,
        account: account || null,
        errorCode: null
      });
    } catch (error) {
      publish({ status: STATUS.ERROR, account: null, errorCode: error.code || 'session-failed' });
      throw error;
    }
  }

  async function requestEmailCode(email) {
    const normalisedEmail = String(email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalisedEmail)) {
      const error = new Error('A valid email address is required.');
      error.code = 'invalid-email';
      publish({ status: adapter ? STATUS.GUEST : STATUS.UNCONFIGURED, errorCode: error.code });
      throw error;
    }

    const service = requireAdapter();
    publish({ status: STATUS.REQUESTING_CODE, pendingEmail: normalisedEmail, errorCode: null });
    try {
      await service.requestEmailCode(normalisedEmail);
      return publish({ status: STATUS.CODE_SENT, errorCode: null });
    } catch (error) {
      publish({ status: STATUS.ERROR, errorCode: error.code || 'request-failed' });
      throw error;
    }
  }

  async function verifyEmailCode(code) {
    const service = requireAdapter();
    const normalisedCode = String(code || '').replace(/\s/g, '');
    if (!normalisedCode) {
      const error = new Error('A verification code is required.');
      error.code = 'invalid-code';
      publish({ status: STATUS.CODE_SENT, errorCode: error.code });
      throw error;
    }

    publish({ status: STATUS.VERIFYING, errorCode: null });
    try {
      const account = await service.verifyEmailCode({
        email: state.pendingEmail,
        code: normalisedCode
      });
      return publish({ status: STATUS.AUTHENTICATED, account, pendingEmail: '', errorCode: null });
    } catch (error) {
      publish({ status: STATUS.ERROR, account: null, errorCode: error.code || 'verification-failed' });
      throw error;
    }
  }

  async function signOut() {
    const service = requireAdapter();
    publish({ status: STATUS.SIGNING_OUT, errorCode: null });
    try {
      await service.signOut();
      return publish({ status: STATUS.GUEST, account: null, pendingEmail: '', errorCode: null });
    } catch (error) {
      publish({ status: STATUS.ERROR, errorCode: error.code || 'sign-out-failed' });
      throw error;
    }
  }

  function can(action) {
    const signedIn = state.status === STATUS.AUTHENTICATED && Boolean(state.account);
    return signedIn && ['create-story', 'create-response', 'create-follow-up', 'manage-own-content'].includes(action);
  }

  // Public renderers must never receive private account identifiers.
  function getPublicIdentity() {
    return Object.freeze({ kind: 'anonymous-member', displayName: 'Anonymous member' });
  }

  window.FFG_AUTH = Object.freeze({
    STATUS,
    configure,
    subscribe,
    getSnapshot: snapshot,
    restoreSession,
    requestEmailCode,
    verifyEmailCode,
    signOut,
    can,
    getPublicIdentity
  });
})();

const authUiState = { initialised: false, messageKey: 'idle' };

const authMessages = Object.freeze({
  idle: {
    zh: '认证后端尚未接入。现在提交不会发送或保存你的邮箱。',
    en: 'The authentication backend is not connected. Submitting now will not send or store your email.'
  },
  'invalid-email': {
    zh: '请输入有效的邮箱地址。',
    en: 'Enter a valid email address.'
  },
  'service-not-configured': {
    zh: '登录界面已经就绪，但正式认证服务仍待接入；没有数据被发送。',
    en: 'The sign-in interface is ready, but the production authentication service is not connected. No data was sent.'
  },
  requesting: { zh: '正在请求验证码……', en: 'Requesting a verification code…' },
  sent: { zh: '验证码已发送，请检查邮箱。', en: 'Code sent. Check your email.' },
  verifying: { zh: '正在验证……', en: 'Verifying…' },
  authenticated: { zh: '已安全登录。', en: 'Signed in securely.' },
  error: { zh: '暂时无法登录，请稍后重试。', en: 'Sign-in is unavailable. Try again later.' }
});

function getAuthUiLanguage() {
  return document.documentElement.dataset.interfaceLanguage === 'en' ? 'en' : 'zh';
}

function setAuthMessage(key) {
  authUiState.messageKey = authMessages[key] ? key : 'error';
  syncAuthUiLanguage();
}

function syncAuthUiLanguage() {
  const status = document.getElementById('auth-status');
  if (!status) return;
  status.textContent = authMessages[authUiState.messageKey][getAuthUiLanguage()];
}

function renderAuthUi(authState) {
  const form = document.getElementById('auth-form');
  const codeStep = document.getElementById('auth-code-step');
  const summary = document.getElementById('authenticated-summary');
  const lockedStories = document.getElementById('my-stories-locked');
  const emptyStories = document.getElementById('my-stories-empty');
  const requestButton = document.getElementById('auth-request-code');
  const verifyButton = document.getElementById('auth-verify-code');
  if (!form || !codeStep || !summary) return;

  const signedIn = authState.status === window.FFG_AUTH.STATUS.AUTHENTICATED;
  const busy = [
    window.FFG_AUTH.STATUS.REQUESTING_CODE,
    window.FFG_AUTH.STATUS.VERIFYING,
    window.FFG_AUTH.STATUS.SIGNING_OUT
  ].includes(authState.status);

  form.hidden = signedIn;
  summary.hidden = !signedIn;
  if (lockedStories) lockedStories.hidden = signedIn;
  if (emptyStories) emptyStories.hidden = !signedIn;
  const codeCanBeRetried = ['invalid-code', 'verification-failed'].includes(authState.errorCode);
  codeStep.hidden = !codeCanBeRetried && ![
      window.FFG_AUTH.STATUS.CODE_SENT,
      window.FFG_AUTH.STATUS.VERIFYING
    ].includes(authState.status);
  if (requestButton) requestButton.disabled = busy;
  if (verifyButton) verifyButton.disabled = busy;

  if (authState.status === window.FFG_AUTH.STATUS.REQUESTING_CODE) setAuthMessage('requesting');
  if (authState.status === window.FFG_AUTH.STATUS.CODE_SENT) setAuthMessage('sent');
  if (authState.status === window.FFG_AUTH.STATUS.VERIFYING) setAuthMessage('verifying');
  if (signedIn) setAuthMessage('authenticated');
}

function initAuthUI() {
  if (authUiState.initialised || !window.FFG_AUTH) return;
  authUiState.initialised = true;

  const form = document.getElementById('auth-form');
  const emailInput = document.getElementById('auth-email');
  const codeInput = document.getElementById('auth-code');
  const verifyButton = document.getElementById('auth-verify-code');
  const signOutButton = document.getElementById('auth-sign-out');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await window.FFG_AUTH.requestEmailCode(emailInput?.value);
    } catch (error) {
      setAuthMessage(error.code || 'error');
      emailInput?.focus();
    }
  });

  verifyButton?.addEventListener('click', async () => {
    try {
      await window.FFG_AUTH.verifyEmailCode(codeInput?.value);
    } catch (error) {
      setAuthMessage(error.code || 'error');
      codeInput?.focus();
    }
  });

  signOutButton?.addEventListener('click', async () => {
    try {
      await window.FFG_AUTH.signOut();
    } catch (error) {
      setAuthMessage(error.code || 'error');
    }
  });

  window.FFG_AUTH.subscribe(renderAuthUi);
  syncAuthUiLanguage();
}
