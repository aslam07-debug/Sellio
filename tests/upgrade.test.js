import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/api/exports/[id]/regenerate/route.js', import.meta.url), 'utf8');
// Execute the actual route with the admin factory isolated; the protected service is real.
const route = await import(`data:text/javascript;base64,${Buffer.from(source
  .replace("import { getSupabaseAdmin } from '@/lib/supabaseAdmin';", 'const getSupabaseAdmin = () => null;')
  .replace("'@/lib/exportService'", JSON.stringify(new URL('../lib/exportService.js', import.meta.url).href))).toString('base64')}`);

for (const [name, params] of [['plain', { id: 'saved-id' }], ['promised', Promise.resolve({ id: 'saved-id' })]]) {
  test(`regeneration route: ${name} params preserve real auth/config and method guards`, async () => {
    const url = 'http://localhost/api/exports/saved-id/regenerate';
    const unsigned = await route.POST(new Request(url, { method: 'POST' }), { params });
    assert.equal(unsigned.status, 401);
    assert.equal(unsigned.headers.get('cache-control'), 'private, no-store');
    assert.equal(unsigned.headers.get('vary'), 'Authorization');
    const configured = await route.POST(new Request(url, { method: 'POST', headers: { Authorization: 'Bearer test-only-not-a-credential' } }), { params });
    assert.equal(configured.status, 503);
    for (const method of ['GET', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
      const rejected = await route[method](new Request(url, { method }), { params });
      assert.equal(rejected.status, 405);
      assert.equal(rejected.headers.get('allow'), 'POST');
    }
  });
}

test('regeneration awaits deferred params and passes the resolved saved ID unchanged', async () => {
  const calls = [];
  globalThis.__sellioUpgradeCalls = calls;
  const delegated = await import(`data:text/javascript;base64,${Buffer.from(source
    .replace("import { getSupabaseAdmin } from '@/lib/supabaseAdmin';", 'const getSupabaseAdmin = () => null;')
    .replace("import { handleExport } from '@/lib/exportService';", 'const handleExport = (...args) => { globalThis.__sellioUpgradeCalls.push(args); return args[3]; };')).toString('base64')}`);
  let release;
  const params = new Promise(resolve => { release = resolve; });
  const request = new Request('http://localhost/api/exports/saved-id/regenerate', { method: 'POST' });
  const pending = delegated.POST(request, { params });
  await Promise.resolve();
  assert.equal(calls.length, 0);
  release({ id: 'saved-id' });
  assert.equal(await pending, 'saved-id');
  assert.deepEqual(calls[0], [request, 'regenerate', null, 'saved-id']);
  delete globalThis.__sellioUpgradeCalls;
});

test('approved security pins and legacy JavaScript Tailwind integration are exact', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.dependencies, {
    '@supabase/supabase-js': '2.99.2', next: '16.4.3', react: '19.2.8', 'react-dom': '19.2.8',
    recharts: '2.15.4', xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz'
  });
  assert.deepEqual(pkg.devDependencies, { '@tailwindcss/postcss': '4.3.3', postcss: '8.5.23', tailwindcss: '4.3.3' });
  assert.deepEqual(pkg.pnpm.overrides, { postcss: '8.5.23', 'recharts>react-is': '19.2.8' });
  assert.equal(pkg.engines.node, '>=20.9.0');
  assert.match(pkg.scripts.build, /next build --webpack$/);
  assert.match(pkg.scripts.dev, /next dev --webpack$/);
  assert.match(read('app/globals.css'), /@import "tailwindcss";\s*@config "\.\.\/tailwind.config.js";/);
  assert.match(read('postcss.config.cjs'), /'@tailwindcss\/postcss'/);
  const lock = read('pnpm-lock.yaml');
  assert.doesNotMatch(lock, /(?:braces|chokidar|micromatch|postcss-selector-parser)@/);
  assert.match(lock, /xlsx@https:\/\/cdn.sheetjs.com\/xlsx-0.20.3\/xlsx-0.20.3.tgz/);
});

test('focus and tooltip renames retain v3 accessibility and shadow semantics', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(read('components/ui/Input.js'), /focus:outline-hidden/);
  assert.match(read('components/export/ExportPage.js'), /focus-visible:outline-hidden/);
  assert.match(read('components/dashboard/ChartTooltip.js'), /shadow-xs/);
  assert.match(read('app/globals.css'), /outline-2 outline-offset-4 outline-primary-dark/);
  for (const file of ['components/ui/Input.js', 'components/export/ExportPage.js']) assert.doesNotMatch(read(file), /outline-none/);
});

test('consumed recovery fragment is cleared through Next history only after a ready gate', () => {
  const reset = readFileSync(new URL('../app/(auth)/reset-password/ResetPasswordForm.js', import.meta.url), 'utf8');
  assert.match(reset, /if \(gate.status === 'ready' && window.location.hash\)\s*\{\s*window.history.replaceState\(null, '', window.location.pathname \+ window.location.search\)/);
  assert.match(reset, /\}, \[gate.status\]\)/);
  const auth = readFileSync(new URL('../lib/supabase.js', import.meta.url), 'utf8');
  assert.match(auth, /onAuthStateChange\(\(event, session\) => recoveryGate.observe\(event, session\)\)/);
});
