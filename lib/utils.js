export const plans = [
  { id: 'starter', name: 'Стартовый', price: '0 ₸' },
  { id: 'pro', name: 'Про', price: 'Стоимость уточняется' },
  { id: 'business', name: 'Бизнес', price: 'Стоимость уточняется' }
];

export const requestedPlan = (value) => plans.some((plan) => plan.id === value) ? value : 'starter';

export const validateRegistration = ({ storeName, email, password, plan }) => {
  const errors = {};
  if (!storeName?.trim()) errors.storeName = 'Введите имя магазина.';
  else if (storeName.trim().length > 100) errors.storeName = 'Имя магазина — не более 100 символов.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim() ?? '')) errors.email = 'Введите корректный email.';
  if ((password?.length ?? 0) < 8) errors.password = 'Пароль должен содержать минимум 8 символов.';
  if (!plans.some((item) => item.id === plan)) errors.plan = 'Выберите тарифный план.';
  return errors;
};

export const getAuthErrorMessage = (error) => {
  if (error?.status === 429 || error?.code === 'over_email_send_rate_limit' || error?.code === 'over_request_rate_limit') {
    return 'Слишком много попыток. Подождите немного и попробуйте снова.';
  }
  if (error?.code === 'user_already_exists') return 'Этот email уже зарегистрирован. Войдите в систему.';
  if (error?.code === 'invalid_credentials') return 'Неверный email или пароль.';
  if (error?.code === 'email_not_confirmed') return 'Подтвердите email по ссылке из письма.';
  if (error?.code === 'weak_password') return 'Выберите более надёжный пароль. Минимум 8 символов.';
  if (error?.code === 'signup_disabled') return 'Регистрация временно недоступна. Попробуйте позже.';
  if (error?.name === 'AuthRetryableFetchError' || error instanceof TypeError) {
    return 'Не удалось подключиться. Проверьте интернет и попробуйте снова.';
  }
  return 'Не удалось выполнить запрос. Попробуйте ещё раз.';
};

export const validateEmail = (email) => (
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim() ?? '') ? {} : { email: 'Введите корректный email.' }
);

export const validateLogin = ({ email, password }) => ({
  ...validateEmail(email),
  ...(!password ? { password: 'Введите пароль.' } : {})
});

export const validateResetPassword = ({ password, confirmPassword }) => ({
  ...((password?.length ?? 0) < 8 ? { password: 'Пароль должен содержать минимум 8 символов.' } : {}),
  ...(!confirmPassword || confirmPassword !== password ? { confirmPassword: 'Пароли должны совпадать.' } : {})
});

// SDK tokens stay in SDK storage under its original sb-<project>-auth-token key.
export const createAuthStorage = (getStores = () => ({
  local: window.localStorage, session: window.sessionStorage
})) => {
  const memory = new Map();
  const preferenceKey = 'sellio-auth-persistence';
  let mode;
  let memoryOnly = false;
  const stores = () => { try { return getStores(); } catch { return {}; } };
  const resolveMode = () => {
    if (!mode) {
      try { mode = stores().session?.getItem(preferenceKey) === 'session' ? 'session' : 'local'; }
      catch { mode = 'local'; }
    }
    return mode;
  };
  return {
    getItem(key) {
      if (memory.has(key)) return memory.get(key);
      if (memoryOnly) return null;
      try { return stores()[resolveMode()]?.getItem(key) ?? null; }
      catch { return null; }
    },
    setItem(key, value) {
      memory.set(key, value);
      const available = stores();
      const selected = resolveMode();
      try {
        available[selected === 'local' ? 'session' : 'local']?.removeItem(key);
        if (!memoryOnly) {
          if (!available[selected]) throw Error('Storage unavailable');
          available[selected].setItem(key, value);
          memory.delete(key);
        }
      } catch { memoryOnly = true; }
    },
    removeItem(key) {
      memory.delete(key);
      const available = stores();
      for (const storage of [available.local, available.session]) {
        try { storage?.removeItem(key); } catch { /* Blocked browser storage. */ }
      }
    },
    setPersistence(remember) {
      mode = remember ? 'local' : 'session';
      memoryOnly = false;
      const available = stores();
      try {
        if (!available[mode]) throw Error('Storage unavailable');
        const probe = `${preferenceKey}-probe`;
        available[mode].setItem(probe, '1');
        available[mode].removeItem(probe);
        // This non-secret marker survives same-tab reloads and OAuth redirects.
        if (available.session) available.session.setItem(preferenceKey, mode);
        else if (!remember) throw Error('Session storage unavailable');
      } catch { memoryOnly = true; }
      return memoryOnly ? 'memory' : mode;
    }
  };
};

// Only a real SDK PASSWORD_RECOVERY event can open this in-memory gate.
export const createRecoveryGate = (now = () => Date.now()) => {
  let initialized = false;
  let error = null;
  let recovery = null;
  const listeners = new Set();
  const snapshot = () => ({
    status: !initialized ? 'checking' : error || !recovery || recovery.expiresAt <= now() ? 'invalid' : 'ready',
    error
  });
  const publish = () => { for (const listener of listeners) listener(snapshot()); };
  return {
    snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    initialized(initializationError = null) {
      initialized = true;
      error = initializationError;
      if (error) recovery = null;
      publish();
    },
    observe(event, session) {
      if (event === 'PASSWORD_RECOVERY' && session?.user?.id && session.expires_at) {
        recovery = { userId: session.user.id, expiresAt: session.expires_at * 1000 };
      } else if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || (recovery && session?.user?.id !== recovery.userId)) {
        recovery = null;
      }
      publish();
    },
    consume() { recovery = null; publish(); }
  };
};
