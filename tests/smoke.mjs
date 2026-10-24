import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const port = 3107;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
server.stdout.on('data', (chunk) => { output += chunk.toString(); });
server.stderr.on('data', (chunk) => { output += chunk.toString(); });

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try {
      const response = await fetch(`${origin}/register`);
      if (response.status === 200) { ready = true; break; }
    } catch {
      // Wait for the local production server to listen.
    }
    await wait(100);
  }
  assert.ok(ready, `Server did not become ready: ${output}`);
  const registration = await fetch(`${origin}/register`);
  const html = await registration.text();
  assert.equal(registration.status, 200);
  assert.match(html, /Регистрация/);
  assert.match(html, /Все заказы Kaspi в одной системе/);
  assert.match(html, /Стоимость уточняется/);
  assert.doesNotMatch(html, /14,900|39,900|за 5 минут/);
  assert.match(html, /Яндекс — пока недоступен/);
  assert.match(html, /autoComplete="new-password"/i);
  assert.match(html, /name="plan"/);
  assert.doesNotMatch(html, /service_role/);
  const cssPath = html.match(/href="([^"]+\.css[^\"]*)"/)?.[1];
  assert.ok(cssPath, 'Compiled stylesheet is linked');
  const css = await fetch(`${origin}${cssPath}`);
  assert.equal(css.status, 200);
  const stylesheet = await css.text();
  assert.match(stylesheet, /\.bg-primary\s*\{[^}]*background-color\s*:\s*#e07b39/i);
  assert.match(stylesheet, /--chart-primary\s*:\s*#e07b39/i);
  assert.match(stylesheet, /body\s*\{[^}]*background-color\s*:\s*#faf8f5/i);
  const login = await fetch(`${origin}/login`);
  assert.equal(login.status, 200);
  const loginHtml = await login.text();
  for (const text of ['Вход в кабинет', 'Введите свои данные для доступа к аналитике.', 'Запомнить меня', 'Забыли пароль?', 'Введите ваш пароль', 'Google', 'Яндекс']) assert.ok(loginHtml.includes(text), text);
  assert.match(loginHtml, /href="\/forgot-password"/);
  assert.match(loginHtml, /type="checkbox"[^>]*checked/);
  const forgot = await fetch(`${origin}/forgot-password`);
  assert.equal(forgot.status, 200);
  const forgotHtml = await forgot.text();
  assert.match(forgotHtml, /Восстановление/);
  assert.match(forgotHtml, /Email адрес/);
  assert.match(forgotHtml, /Отправить ссылку/);
  assert.match(forgotHtml, /href="\/login"/);
  const reset = await fetch(`${origin}/reset-password`);
  assert.equal(reset.status, 200);
  assert.match(await reset.text(), /Проверяем ссылку/);
  const onboarding = await fetch(`${origin}/onboarding`);
  assert.equal(onboarding.status, 200);
  assert.match(await onboarding.text(), /Проверяем сессию/);
   for (const endpoint of ['verify', 'sync']) {
    const unsigned = await fetch(`${origin}/api/kaspi/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(unsigned.status, 401);
    assert.equal(unsigned.headers.get('cache-control'), 'no-store');
    const unconfigured = await fetch(`${origin}/api/kaspi/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-only-not-a-credential' }, body: '{}' });
    assert.equal(unconfigured.status, 503);
    assert.doesNotMatch(await unconfigured.text(), /test-only|SUPABASE_SERVICE_ROLE_KEY|api_token_encrypted/);
  }
  for (const page of ['dashboard', 'orders', 'stock', 'settings', 'export']) {
    const response = await fetch(`${origin}/${page}`); assert.equal(response.status, 200); assert.match(await response.text(), /Проверяем сессию/);
  }
  for (const endpoint of ['dashboard/summary', 'dashboard/cities', 'dashboard/top-sku', 'dashboard/revenue-by-day', 'kaspi/orders', 'stores']) {
    const target = `${origin}/api/${endpoint}?storeId=s1&start=2026-06-01&end=2026-06-14`;
    for (const method of endpoint === 'kaspi/orders' ? ['GET', 'PATCH'] : ['GET']) {
      const unsigned = await fetch(target, { method }); assert.equal(unsigned.status, 401); assert.match(unsigned.headers.get('cache-control'), /no-store/);
      const config = await fetch(target, { method, headers: { Authorization: 'Bearer test-only-not-a-credential' } }); assert.equal(config.status, 503); assert.doesNotMatch(await config.text(), /test-only|SUPABASE_SERVICE_ROLE_KEY|api_token_encrypted/);
    }
    assert.equal((await fetch(target, { method: 'POST' })).status, 405);
  }
  const csvUnsigned = await fetch(`${origin}/api/kaspi/orders?format=csv`); assert.equal(csvUnsigned.status, 401);
  let localChecks = 0;
  for (const [endpoint, methods] of [['stock', ['GET', 'POST']], ['stock/rebase', ['POST']], ['stock/set-price', ['POST']], ['stock/toggle', ['POST']], ['settings/profile', ['GET', 'PATCH']], ['settings/stores', ['GET', 'POST']]]) {
    for (const method of methods) {
      const target = `${origin}/api/${endpoint}`;
      const unsigned = await fetch(target, { method }); assert.equal(unsigned.status, 401); assert.match(unsigned.headers.get('cache-control'), /private, no-store/); assert.ok(unsigned.headers.get('vary')?.split(',').map(v => v.trim()).includes('Authorization'));
      const config = await fetch(target, { method, headers: { Authorization: 'Bearer test-only-not-a-credential' } }); assert.equal(config.status, 503); assert.doesNotMatch(await config.text(), /test-only|SUPABASE_SERVICE_ROLE_KEY|api_token_encrypted/); localChecks++;
    }
    assert.equal((await fetch(`${origin}/api/${endpoint}`, { method: 'DELETE' })).status, 405);
  }
  assert.equal(localChecks, 9);
  for (const [endpoint, method] of [['exports', 'POST'], ['exports/history', 'GET'], ['exports/mock-id/regenerate', 'POST']]) {
    const target = `${origin}/api/${endpoint}`;
    const unsigned = await fetch(target, { method }); assert.equal(unsigned.status, 401); assert.match(unsigned.headers.get('cache-control'), /private, no-store/);
    const config = await fetch(target, { method, headers: { Authorization: 'Bearer test-only-not-a-credential' } }); assert.equal(config.status, 503); assert.doesNotMatch(await config.text(), /test-only|SUPABASE_SERVICE_ROLE_KEY|api_token_encrypted/);
    const wrong = await fetch(target, { method: 'DELETE' }); assert.equal(wrong.status, 405); assert.equal(wrong.headers.get('allow'), method);
  }
  const home = await fetch(origin, { redirect: 'manual' });
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('location'), null);
  const homeHtml = await home.text();
  for (const id of ['main', 'features', 'how-it-works', 'demo', 'pricing', 'faq']) assert.ok(homeHtml.includes(`id="${id}"`), id);
  assert.match(homeHtml, /Синтетические демонстрационные данные/);
  assert.match(homeHtml, /Стоимость уточняется/);
  assert.match(homeHtml, /<details/);
  assert.match(homeHtml, /role="tablist"/);
  assert.doesNotMatch(homeHtml, /340\+|4\.9|14,900|39,900|GoogleWorkspace/);
  const pricing = await fetch(`${origin}/pricing`);
  assert.equal(pricing.status, 200);
  const pricingHtml = await pricing.text();
  assert.match(pricingHtml, /Стоимость уточняется/);
  for (const plan of ['starter', 'pro', 'business']) {
    assert.ok(pricingHtml.includes(`/register?plan=${plan}`));
    const query = await fetch(`${origin}/register?plan=${plan}`);
    assert.equal(query.status, 200);
    assert.match(await query.text(), /Стоимость уточняется/);
  }
  const missing = await fetch(`${origin}/nonexistent-route`);
  assert.equal(missing.status, 404);
  const scan = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (file.endsWith('.js')) assert.doesNotMatch(readFileSync(file, 'utf8'), /SUPABASE_SERVICE_ROLE_KEY|KASPI_TOKEN_ENCRYPTION_KEY|api_token_encrypted|shop\/api\/v2|SheetJS|writeFileSync|xlsx-0\.20\.3|application\/vnd\.openxmlformats/);
    }
  };
  scan('.next/static');
   process.stdout.write('Production smoke passed: twelve pages plus three signup queries; 22 unsigned 401 and 21 unconfigured 503 checks; 15 method 405 checks; private no-store, safe errors, server-only XLSX/client-bundle boundaries, CSS, public root 200, pricing 200, pending prices, anchors and 404.\n');
} finally {
  server.kill('SIGTERM');
  if (server.exitCode === null) await new Promise((resolve) => server.once('exit', resolve));
}
