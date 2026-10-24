import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { demoOrders, summarizeDemo, estimateRoutine, features, faqs, demoCities, statuses } from '../components/landing/model.js';
import { plans, requestedPlan } from '../lib/utils.js';

test('stable plan IDs have only one confirmed price', () => {
  assert.deepEqual(plans.map((plan) => plan.id), ['starter', 'pro', 'business']);
  assert.equal(plans[0].price, '0 ₸');
  assert.ok(plans.slice(1).every((plan) => plan.price === 'Стоимость уточняется'));
});
test('query preference admits only stable IDs', () => {
  for (const value of [null, undefined, '', 'admin', 'PRO', ' pro', ['pro'], 'business<script>']) assert.equal(requestedPlan(value), 'starter');
  for (const { id } of plans) assert.equal(requestedPlan(id), id);
});
test('demo totals derive only from completed synthetic orders', () => {
  const summary = summarizeDemo();
  assert.equal(summary.count, 6);
  assert.equal(summary.completed, 4);
  assert.equal(summary.amount, 48000);
  assert.equal(summary.average, 12000);
  assert.equal(summary.cities.reduce((sum, city) => sum + city.count, 0), summary.count);
  assert.ok(demoOrders.every((order) => order.code.startsWith('DEMO-')));
  assert.ok(!('profit' in summary));
});
test('every demo status and city combination respects filters and totals', () => {
  for (const status of Object.keys(statuses)) for (const city of demoCities) {
    const summary = summarizeDemo(status, city);
    assert.ok(summary.orders.every((order) => (status === 'all' || status === order.status) && (city === 'all' || city === order.city)));
    assert.equal(summary.amount, summary.orders.filter((order) => order.status === 'completed').reduce((sum, order) => sum + order.amount, 0));
    assert.equal(summary.cities.reduce((sum, entry) => sum + entry.count, 0), summary.count);
  }
});
test('empty demo selection and unfinished amounts do not invent revenue', () => {
  assert.equal(summarizeDemo('cancelled', 'Шымкент').count, 0);
  assert.equal(summarizeDemo('delivery').amount, 0);
  assert.equal(summarizeDemo('cancelled').average, 0);
});
test('routine calculation uses 52 weeks and 12 months, not a saving coefficient', () => {
  assert.deepEqual(estimateRoutine(6, 2000), { monthly: 26, annual: 312, annualValue: 624000 });
  assert.deepEqual(estimateRoutine(0, 0), { monthly: 0, annual: 0, annualValue: 0 });
  assert.equal(estimateRoutine('1.5', '0').annual, 78);
});
test('routine rejects blanks, invalid types, infinities, negatives and out-of-bounds inputs', () => {
  for (const value of ['', ' ', null, undefined, true, [], NaN, Infinity, -1, 169, '1e309']) assert.equal(estimateRoutine(value, 0), null);
  for (const value of ['', Infinity, -1, 1000001]) assert.equal(estimateRoutine(1, value), null);
  assert.ok(estimateRoutine(168, 1000000));
});
test('feature and FAQ content is complete and explicit about MVP limits', () => {
  assert.equal(new Set(features.map((feature) => feature.id)).size, 4);
  assert.ok(features.every((feature) => feature.name && feature.title && feature.description && feature.points.length));
  assert.equal(faqs.length, 8);
  assert.ok(faqs.every(([question, answer]) => question.length > 10 && answer.length > 70));
  assert.match(faqs.flat().join(' '), /RLS/);
  assert.match(faqs.flat().join(' '), /users.plan/);
  assert.match(faqs.flat().join(' '), /фонового обновления.*нет/);
});
test('public landing code has no private imports, data requests or fabricated billing', () => {
  const files = readdirSync(new URL('../components/landing/', import.meta.url));
  const source = files.map((file) => readFileSync(new URL(`../components/landing/${file}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(source, /fetch\(|supabase|useReport|useResource|\/api\/|service_role|14,900|39,900|2,900|9,900|\$237|\$312/);
  assert.doesNotMatch(source, /href=["']#['"]|\/terms|\/privacy|<button|style=|bg-gray|text-gray/);
  assert.match(source, /<details/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /aria-selected/);
  assert.match(source, /aria-expanded/);
});
test('homepage contains all eleven content bands and root no longer redirects', () => {
  const source = readFileSync(new URL('../app/(landing)/page.js', import.meta.url), 'utf8');
  for (const name of ['Hero', 'TrustStrip', 'Comparison', 'Features', 'HowItWorks', 'Demo', 'UseCases', 'Calculator', 'Pricing', 'FAQ', 'FinalCTA']) assert.ok(source.includes(`<${name}`));
  assert.doesNotMatch(source, /redirect/);
  assert.doesNotMatch(readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8'), /destination.*register/);
});
test('signup query preference stays separate from authorization', () => {
  const source = readFileSync(new URL('../app/(auth)/register/RegisterForm.js', import.meta.url), 'utf8');
  assert.match(source, /requestedPlan\(params.get\('plan'\)\)/);
  assert.match(source, /requested_plan: values.plan/);
  assert.doesNotMatch(source, /users\.plan\s*=|from\(['"]users/);
  assert.ok(source.indexOf('requestedPlan(params') < source.indexOf('if (!supabase) return'));
});
