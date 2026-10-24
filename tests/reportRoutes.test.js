import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('all actual read/PATCH route exports use the authorized report service and separate admin', async () => {
  const routes = { 'dashboard/summary': 'summary', 'dashboard/cities': 'cities', 'dashboard/top-sku': 'products', 'dashboard/revenue-by-day': 'revenue', 'kaspi/orders': 'orders', stores: 'stores' };
  for (const [path, kind] of Object.entries(routes)) {
    const source = fs.readFileSync(`app/api/${path}/route.js`, 'utf8');
    assert.match(source, /@\/lib\/supabaseAdmin/); assert.match(source, /force-dynamic/);
    const calls = [], admin = {};
    const context = vm.createContext({ getSupabaseAdmin: () => admin, handleReport: (...args) => { calls.push(args); return { status: 401 }; } });
    vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/export const /g, 'var '), context);
    const request = new Request('http://localhost/api');
    assert.equal(context.GET(request).status, 401);
    if (kind === 'orders') assert.equal(context.PATCH(request).status, 401);
    else assert.equal(context.PATCH, undefined);
    assert.equal(context.POST, undefined);
    for (const args of calls) assert.deepEqual(args, [request, kind, admin]);
  }
});
test('shell/page source retains approved boundaries, working CTAs and stale response guards', () => {
  const context = fs.readFileSync('components/shell/AppContext.js', 'utf8');
  assert.match(context, /onAuthStateChange/); assert.match(context, /PASSWORD_RECOVERY/); assert.match(context, /storeState.owner === session\?\.user\?\.id/);
  const hook = fs.readFileSync('components/shell/useReport.js', 'utf8'); assert.match(hook, /state.scope === scope/); assert.match(hook, /request.current\(\)/); assert.match(hook, /signal: request.signal/);
  const onboarding = fs.readFileSync('components/onboarding/OnboardingWizard.js', 'utf8'); assert.match(onboarding, /step === 3 && summary/); assert.match(onboarding, /router.push\('\/dashboard'\)/);
  for (const path of ['app/(app)/dashboard/page.js', 'app/(app)/orders/page.js']) assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /<button|fetch\(|style=/);
  const orders = fs.readFileSync('components/orders/Orders.js', 'utf8'); assert.match(orders, /URL.revokeObjectURL/); assert.doesNotMatch(orders, /method: 'PATCH'/);
});
