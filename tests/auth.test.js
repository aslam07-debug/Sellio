import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthErrorMessage, plans, validateRegistration } from '../lib/utils.js';

const valid = { storeName: 'Delano', email: 'seller@example.com', password: 'password123', plan: 'pro' };

test('accepts a valid registration', () => {
  assert.deepEqual(validateRegistration(valid), {});
});
test('validates missing fields without throwing', () => {
  assert.deepEqual(Object.keys(validateRegistration({})), ['storeName', 'email', 'password', 'plan']);
});
test('requires a nonblank store name', () => {
  assert.ok(validateRegistration({ ...valid, storeName: '  ' }).storeName);
});
test('limits store names to 100 characters', () => {
  assert.ok(validateRegistration({ ...valid, storeName: 'a'.repeat(101) }).storeName);
  assert.equal(validateRegistration({ ...valid, storeName: 'a'.repeat(100) }).storeName, undefined);
});
test('rejects invalid emails and accepts trimmed emails', () => {
  for (const email of ['bad', 'seller@', 'a b@example.com', 'a@@example.com']) {
    assert.ok(validateRegistration({ ...valid, email }).email);
  }
  assert.equal(validateRegistration({ ...valid, email: ' seller@example.com ' }).email, undefined);
});
test('requires at least eight password characters', () => {
  assert.ok(validateRegistration({ ...valid, password: '1234567' }).password);
  assert.equal(validateRegistration({ ...valid, password: '12345678' }).password, undefined);
});
test('allows only the three displayed plans', () => {
  assert.ok(validateRegistration({ ...valid, plan: 'admin' }).plan);
  for (const { id } of plans) assert.equal(validateRegistration({ ...valid, plan: id }).plan, undefined);
});
test('shows only confirmed starter price and pending paid prices', () => {
  assert.deepEqual(plans.map(({ price }) => price), ['0 ₸', 'Стоимость уточняется', 'Стоимость уточняется']);
});
test('provides a rate-limit message', () => {
  assert.match(getAuthErrorMessage({ status: 429 }), /Слишком много/);
});
test('provides an actionable invalid-login message', () => {
  assert.match(getAuthErrorMessage({ code: 'invalid_credentials' }), /Неверный/);
});
test('never displays raw server errors', () => {
  assert.equal(getAuthErrorMessage({ message: 'private server details' }).includes('private'), false);
});
test('handles network failures', () => {
  assert.match(getAuthErrorMessage(new TypeError('Failed to fetch')), /интернет/);
});
