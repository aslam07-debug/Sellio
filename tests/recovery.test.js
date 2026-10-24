import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthStorage, createRecoveryGate, validateEmail, validateLogin, validateResetPassword } from '../lib/utils.js';

const store = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
};
const key = 'sb-existing-project-auth-token';
const session = { user: { id: 'recovery-user' }, expires_at: 20 };

test('login validates email and requires a password without imposing signup length', () => {
  assert.deepEqual(Object.keys(validateLogin({})), ['email', 'password']);
  assert.deepEqual(validateLogin({ email: ' seller@example.com ', password: 'old' }), {});
  assert.ok(validateLogin({ email: 'a@@example.com', password: 'x' }).email);
});
test('recovery email validation handles missing and malformed input', () => {
  for (const email of [undefined, '', 'a b@example.com', 'seller@']) assert.ok(validateEmail(email).email);
  assert.deepEqual(validateEmail(' seller@example.com '), {});
});
test('new password requires eight characters and exact confirmation', () => {
  assert.deepEqual(Object.keys(validateResetPassword({})), ['password', 'confirmPassword']);
  assert.ok(validateResetPassword({ password: '1234567', confirmPassword: '1234567' }).password);
  assert.ok(validateResetPassword({ password: '12345678', confirmPassword: '12345678 ' }).confirmPassword);
  assert.deepEqual(validateResetPassword({ password: '12345678', confirmPassword: '12345678' }), {});
});
test('default registration storage reads the original SDK localStorage key', () => {
  const stores = { local: store(), session: store() };
  stores.local.setItem(key, 'sdk-session');
  assert.equal(createAuthStorage(() => stores).getItem(key), 'sdk-session');
});
test('unchecked remember-me moves SDK writes to sessionStorage and removes stale local tokens', () => {
  const stores = { local: store(), session: store() };
  stores.local.setItem(key, 'old');
  const adapter = createAuthStorage(() => stores);
  assert.equal(adapter.setPersistence(false), 'session');
  adapter.setItem(key, 'new');
  assert.equal(stores.local.getItem(key), null);
  assert.equal(stores.session.getItem(key), 'new');
  assert.equal(createAuthStorage(() => stores).getItem(key), 'new', 'same-tab reload preserves session');
  assert.equal(createAuthStorage(() => ({ local: stores.local, session: store() })).getItem(key), null, 'closed-tab session is not restored');
});
test('checked remember-me persists across visits and removes session copy', () => {
  const stores = { local: store(), session: store() };
  const adapter = createAuthStorage(() => stores);
  adapter.setPersistence(false);
  adapter.setItem(key, 'temporary');
  assert.equal(adapter.setPersistence(true), 'local');
  adapter.setItem(key, 'persistent');
  assert.equal(stores.session.getItem(key), null);
  assert.equal(createAuthStorage(() => ({ local: stores.local, session: store() })).getItem(key), 'persistent');
  adapter.removeItem(key);
  assert.equal(stores.local.getItem(key), null);
});
test('unavailable browser storage and SSR safely fall back to instance memory', () => {
  const adapter = createAuthStorage(() => { throw new Error('blocked'); });
  assert.equal(adapter.getItem(key), null);
  assert.equal(adapter.setPersistence(false), 'memory');
  adapter.setItem(key, 'sdk-session');
  assert.equal(adapter.getItem(key), 'sdk-session');
  adapter.removeItem(key);
  assert.equal(adapter.getItem(key), null);
  assert.equal(createAuthStorage().getItem(key), null);
});
test('quota errors do not throw or silently select persistent storage for unchecked login', () => {
  const blocked = { getItem: () => null, setItem: () => { throw Error('quota'); }, removeItem: () => {} };
  const stores = { local: store(), session: blocked };
  const adapter = createAuthStorage(() => stores);
  assert.equal(adapter.setPersistence(false), 'memory');
  adapter.setItem(key, 'temporary');
  assert.equal(stores.local.getItem(key), null);
  assert.equal(adapter.getItem(key), 'temporary');
});
test('ordinary persisted session or SIGNED_IN cannot unlock password reset', () => {
  const gate = createRecoveryGate(() => 1000);
  gate.observe('INITIAL_SESSION', session);
  gate.initialized();
  assert.equal(gate.snapshot().status, 'invalid');
  gate.observe('SIGNED_IN', session);
  assert.equal(gate.snapshot().status, 'invalid');
});
test('recovery event before mounting is retained but requires successful initialization', () => {
  const gate = createRecoveryGate(() => 1000);
  gate.observe('PASSWORD_RECOVERY', session);
  assert.equal(gate.snapshot().status, 'checking');
  gate.initialized();
  assert.equal(gate.snapshot().status, 'ready');
});
test('mock SDK delayed recovery event after initialization opens the gate without async listener work', async () => {
  const gate = createRecoveryGate(() => 1000);
  let callback;
  const auth = {
    onAuthStateChange(listener) { callback = listener; },
    async initialize() { setTimeout(() => callback('PASSWORD_RECOVERY', session), 0); return { error: null }; }
  };
  auth.onAuthStateChange((event, value) => gate.observe(event, value));
  gate.initialized((await auth.initialize()).error);
  assert.equal(gate.snapshot().status, 'invalid');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(gate.snapshot().status, 'ready');
});
test('failed initialization stays invalid even after a later recovery event', () => {
  const gate = createRecoveryGate(() => 1000);
  const error = new Error('expired callback');
  gate.observe('PASSWORD_RECOVERY', session);
  gate.initialized(error);
  gate.observe('PASSWORD_RECOVERY', session);
  assert.equal(gate.snapshot().status, 'invalid');
  assert.equal(gate.snapshot().error, error);
});
test('recovery expires, is consumed after save, and is never persisted across reload', () => {
  let now = 1000;
  const gate = createRecoveryGate(() => now);
  gate.initialized();
  gate.observe('PASSWORD_RECOVERY', session);
  now = 20000;
  assert.equal(gate.snapshot().status, 'invalid');
  now = 1000;
  gate.consume();
  assert.equal(gate.snapshot().status, 'invalid');
  const reloaded = createRecoveryGate(() => now);
  reloaded.initialized();
  reloaded.observe('INITIAL_SESSION', session);
  assert.equal(reloaded.snapshot().status, 'invalid');
});
test('signout, another user, and ordinary reauthentication revoke recovery', () => {
  for (const [event, value] of [['SIGNED_OUT', null], ['TOKEN_REFRESHED', { user: { id: 'other' } }], ['SIGNED_IN', session]]) {
    const gate = createRecoveryGate(() => 1000);
    gate.initialized();
    gate.observe('PASSWORD_RECOVERY', session);
    gate.observe(event, value);
    assert.equal(gate.snapshot().status, 'invalid');
  }
});
test('same-user refresh preserves the original deadline; unmount unsubscribes notifications', () => {
  const gate = createRecoveryGate(() => 1000);
  let calls = 0;
  const unsubscribe = gate.subscribe(() => { calls += 1; });
  gate.initialized();
  gate.observe('PASSWORD_RECOVERY', session);
  gate.observe('TOKEN_REFRESHED', session);
  assert.equal(gate.snapshot().status, 'ready');
  unsubscribe();
  gate.consume();
  assert.equal(calls, 3);
});
