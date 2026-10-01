'use strict';

// V0.2 authentication boundary.
// This module deliberately contains no demo account, localStorage token, or
// provider SDK. A production adapter must be configured before data is sent.
(function createAuthenticationModule() {
  const STATUS = Object.freeze({
    UNCONFIGURED: 'unconfigured',
    GUEST: 'guest',
    RESTORING_SESSION: 'restoring-session',
    REQUESTING_CODE: 'requesting-code',
    CODE_SENT: 'code-sent',
    VERIFYING: 'verifying',
    AUTHENTICATED: 'authenticated',
    SIGNING_OUT: 'signing-out',
    ERROR: 'error'
  });

  const REQUIRED_ADAPTER_METHODS = [
    'restoreSession',
    'requestPhoneCode',
    'verifyPhoneCode',
    'signOut'
  ];

  let adapter = null;
  let state = {
    status: STATUS.UNCONFIGURED,
    account: null,
    pendingPhone: '',
    errorCode: null
  };
  const listeners = new Set();

  function snapshot() {
    return Object.freeze({
      status: state.status,
      account: state.account ? Object.freeze({ ...state.account }) : null,
      pendingPhoneHint: state.pendingPhone ? `******${state.pendingPhone.slice(-4)}` : '',
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
    publish({ status: STATUS.RESTORING_SESSION, errorCode: null });
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

  function normaliseMainlandPhone(phone) {
    const digits = String(phone || '').replace(/[^\d]/g, '');
    const nationalNumber = digits.startsWith('86') && digits.length === 13
      ? digits.slice(2)
      : digits;
    return /^1[3-9]\d{9}$/.test(nationalNumber) ? `+86${nationalNumber}` : '';
  }

  async function requestPhoneCode(phone) {
    const normalisedPhone = normaliseMainlandPhone(phone);
    if (!normalisedPhone) {
      const error = new Error('A valid mainland China mobile number is required.');
      error.code = 'invalid-phone';
      publish({ status: adapter ? STATUS.GUEST : STATUS.UNCONFIGURED, errorCode: error.code });
      throw error;
    }

    const service = requireAdapter();
    publish({ status: STATUS.REQUESTING_CODE, pendingPhone: normalisedPhone, errorCode: null });
    try {
      await service.requestPhoneCode(normalisedPhone);
      return publish({ status: STATUS.CODE_SENT, errorCode: null });
    } catch (error) {
      publish({ status: STATUS.ERROR, errorCode: error.code || 'request-failed' });
      throw error;
    }
  }

  async function verifyPhoneCode(code) {
    const service = requireAdapter();
    const normalisedCode = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(normalisedCode)) {
      const error = new Error('A six-digit verification code is required.');
      error.code = 'invalid-code';
      publish({ status: STATUS.CODE_SENT, errorCode: error.code });
      throw error;
    }

    publish({ status: STATUS.VERIFYING, errorCode: null });
    try {
      const account = await service.verifyPhoneCode({
        phone: state.pendingPhone,
        code: normalisedCode
      });
      return publish({ status: STATUS.AUTHENTICATED, account, pendingPhone: '', errorCode: null });
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
      return publish({ status: STATUS.GUEST, account: null, pendingPhone: '', errorCode: null });
    } catch (error) {
      publish({ status: STATUS.ERROR, errorCode: error.code || 'sign-out-failed' });
      throw error;
    }
  }

  function resetVerification() {
    return publish({
      status: adapter ? STATUS.GUEST : STATUS.UNCONFIGURED,
      pendingPhone: '',
      errorCode: null
    });
  }

  function can(action) {
    const signedIn = state.status === STATUS.AUTHENTICATED && Boolean(state.account);
    if (!signedIn) return false;
    if (action === 'review-content') {
      return ['moderator', 'administrator'].includes(state.account.role);
    }
    return ['create-story', 'create-response', 'create-follow-up', 'manage-own-content'].includes(action);
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
    requestPhoneCode,
    verifyPhoneCode,
    resetVerification,
    signOut,
    can,
    getPublicIdentity
  });
})();

const authUiState = { initialised: false, messageKey: 'idle' };

const authMessages = Object.freeze({
  idle: {
    zh: '认证后端尚未接入。现在提交不会发送或保存你的手机号。',
    en: 'The authentication backend is not connected. Submitting now will not send or store your mobile number.'
  },
  ready: {
    zh: '可以使用手机号验证私密账户；公开内容不会显示你的号码。',
    en: 'You can verify a private account by mobile. Your number will not appear publicly.'
  },
  'invalid-phone': {
    zh: '请输入有效的中国大陆手机号。',
    en: 'Enter a valid mainland China mobile number.'
  },
  'invalid-code': {
    zh: '请输入六位短信验证码。',
    en: 'Enter the six-digit SMS verification code.'
  },
  'service-not-configured': {
    zh: '登录界面已经就绪，但正式认证服务仍待接入；没有数据被发送。',
    en: 'The sign-in interface is ready, but the production authentication service is not connected. No data was sent.'
  },
  requesting: { zh: '正在请求验证码……', en: 'Requesting a verification code…' },
  restoring: { zh: '正在检查登录状态……', en: 'Checking your sign-in status…' },
  sent: { zh: '短信验证码已发送，请检查手机。', en: 'SMS code sent. Check your mobile phone.' },
  verifying: { zh: '正在验证……', en: 'Verifying…' },
  authenticated: { zh: '已安全登录。', en: 'Signed in securely.' },
  error: { zh: '暂时无法登录，请稍后重试。', en: 'Sign-in is unavailable. Try again later.' },
  'network-error': {
    zh: '暂时无法连接登录服务，请检查网络后重试。',
    en: 'The sign-in service could not be reached. Check your connection and try again.'
  },
  'rate-limited': {
    zh: '请求过于频繁，请稍后再试。',
    en: 'Too many attempts. Wait a moment and try again.'
  },
  'code-expired': {
    zh: '验证码已过期，请重新获取。',
    en: 'The verification code has expired. Request a new one.'
  },
  'invalid-csrf': {
    zh: '登录安全状态已过期，请刷新页面后重试。',
    en: 'Your sign-in security state expired. Refresh the page and try again.'
  },
  'account-suspended': {
    zh: '这个账户目前无法登录。如需帮助，请通过正式申诉渠道联系我们。',
    en: 'This account cannot sign in. Use the official appeal channel if you need help.'
  }
});

const authNavigationLabels = Object.freeze({
  guest: { zh: '登录', en: 'Sign in' },
  authenticated: { zh: '我的账户', en: 'My account' }
});

const authPrivacyNotes = Object.freeze({
  unconfigured: {
    zh: '认证服务尚未接入；当前表单不会发送或保存手机号或验证码。',
    en: 'Authentication is not connected. This form sends and stores no mobile number or code.'
  },
  development: {
    zh: '本地开发认证已连接。验证码只显示在服务端终端，不会发送真实短信。',
    en: 'Local development authentication is connected. Codes appear only in the server terminal; no real SMS is sent.'
  },
  production: {
    zh: '手机号由私密认证服务处理，不会显示在公开故事、回应或后续更新中。',
    en: 'Your mobile number is handled by the private sign-in service and never appears with public content.'
  }
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
  const privacyNote = document.getElementById('auth-privacy-note');
  const language = getAuthUiLanguage();
  if (status) status.textContent = authMessages[authUiState.messageKey][language];

  if (privacyNote && window.FFG_AUTH) {
    const authState = window.FFG_AUTH.getSnapshot();
    const environment = window.FFG_RUNTIME_CONFIG?.environment;
    const noteKey = authState.status === window.FFG_AUTH.STATUS.UNCONFIGURED
      ? 'unconfigured'
      : environment === 'production' ? 'production' : 'development';
    privacyNote.textContent = authPrivacyNotes[noteKey][language];
  }

  const accountLink = document.querySelector('.nav-account-link');
  if (accountLink && window.FFG_AUTH) {
    const signedIn = window.FFG_AUTH.getSnapshot().status === window.FFG_AUTH.STATUS.AUTHENTICATED;
    accountLink.textContent = authNavigationLabels[signedIn ? 'authenticated' : 'guest'][language];
  }
}

function renderAuthUi(authState) {
  const form = document.getElementById('auth-form');
  const codeStep = document.getElementById('auth-code-step');
  const summary = document.getElementById('authenticated-summary');
  const lockedStories = document.getElementById('my-stories-locked');
  const emptyStories = document.getElementById('my-stories-empty');
  const requestButton = document.getElementById('auth-request-code');
  const verifyButton = document.getElementById('auth-verify-code');
  const changePhoneButton = document.getElementById('auth-change-phone');
  const phoneInput = document.getElementById('auth-phone');
  const codeInput = document.getElementById('auth-code');
  if (!form || !codeStep || !summary) return;

  const signedIn = authState.status === window.FFG_AUTH.STATUS.AUTHENTICATED;
  const isReviewer = signedIn
    && ['moderator', 'administrator'].includes(authState.account?.role);
  const busy = [
    window.FFG_AUTH.STATUS.RESTORING_SESSION,
    window.FFG_AUTH.STATUS.REQUESTING_CODE,
    window.FFG_AUTH.STATUS.VERIFYING,
    window.FFG_AUTH.STATUS.SIGNING_OUT
  ].includes(authState.status);
  const codeVisible = ['invalid-code', 'verification-failed'].includes(authState.errorCode)
    || [window.FFG_AUTH.STATUS.CODE_SENT, window.FFG_AUTH.STATUS.VERIFYING].includes(authState.status);

  form.hidden = signedIn;
  summary.hidden = !signedIn;
  document.querySelectorAll('[data-moderator-only]').forEach((element) => {
    element.hidden = !isReviewer;
  });
  if (lockedStories) lockedStories.hidden = signedIn;
  if (emptyStories) emptyStories.hidden = !signedIn;
  codeStep.hidden = !codeVisible;
  if (requestButton) {
    requestButton.disabled = busy;
    requestButton.hidden = codeVisible;
  }
  if (verifyButton) verifyButton.disabled = busy;
  if (changePhoneButton) changePhoneButton.disabled = busy;
  if (phoneInput) phoneInput.disabled = busy || codeVisible;
  if (codeInput) codeInput.disabled = busy;

  if (authState.status === window.FFG_AUTH.STATUS.REQUESTING_CODE) setAuthMessage('requesting');
  if (authState.status === window.FFG_AUTH.STATUS.RESTORING_SESSION) setAuthMessage('restoring');
  if (authState.status === window.FFG_AUTH.STATUS.GUEST) setAuthMessage('ready');
  if (authState.status === window.FFG_AUTH.STATUS.CODE_SENT) setAuthMessage('sent');
  if (authState.status === window.FFG_AUTH.STATUS.VERIFYING) setAuthMessage('verifying');
  if (signedIn) setAuthMessage('authenticated');
  if (authState.status === window.FFG_AUTH.STATUS.ERROR) {
    setAuthMessage(authState.errorCode || 'error');
  }
  syncAuthUiLanguage();
}

function initAuthUI() {
  if (authUiState.initialised || !window.FFG_AUTH) return;
  authUiState.initialised = true;

  const form = document.getElementById('auth-form');
  const phoneInput = document.getElementById('auth-phone');
  const codeInput = document.getElementById('auth-code');
  const verifyButton = document.getElementById('auth-verify-code');
  const changePhoneButton = document.getElementById('auth-change-phone');
  const signOutButton = document.getElementById('auth-sign-out');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await window.FFG_AUTH.requestPhoneCode(phoneInput?.value);
      codeInput?.focus();
    } catch (error) {
      setAuthMessage(error.code || 'error');
      phoneInput?.focus();
    }
  });

  verifyButton?.addEventListener('click', async () => {
    try {
      await window.FFG_AUTH.verifyPhoneCode(codeInput?.value);
      form?.reset();
    } catch (error) {
      setAuthMessage(error.code || 'error');
      codeInput?.focus();
    }
  });

  changePhoneButton?.addEventListener('click', () => {
    window.FFG_AUTH.resetVerification();
    if (codeInput) codeInput.value = '';
    phoneInput?.focus();
  });

  signOutButton?.addEventListener('click', async () => {
    try {
      await window.FFG_AUTH.signOut();
      form?.reset();
    } catch (error) {
      setAuthMessage(error.code || 'error');
    }
  });

  window.FFG_AUTH.subscribe(renderAuthUi);
  syncAuthUiLanguage();
}
