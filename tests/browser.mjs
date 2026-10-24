import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { makeExportFile } from '../lib/exportFile.js';
import { buildExportTable } from '../lib/exportData.js';
import { buildReports, parseReportQuery, sanitizeOrder } from '../lib/reportData.js';
import { defaultPeriod } from '../lib/reportView.js';
import { stockDto } from '../lib/stockData.js';
import { mkdirSync } from 'node:fs';

// Optional external browser harness. No Playwright package is added to Sellio.
const { chromium } = await import(process.env.BROWSER_PLAYWRIGHT_MODULE || '/opt/playwright-mcp/node_modules/playwright/index.mjs');
const origin = 'http://localhost:3108';
const artifacts = process.env.BROWSER_ARTIFACT_DIR;
if (artifacts) mkdirSync(artifacts, { recursive: true });
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '-p', '3108'], { env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: 'https://sellio-test.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only-public-key', SUPABASE_SERVICE_ROLE_KEY: '', KASPI_TOKEN_ENCRYPTION_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', browser, assertions = 0;
server.stdout.on('data', c => { output += c; }); server.stderr.on('data', c => { output += c; });
const check = (actual, expected = true) => { assert.equal(actual, expected); assertions++; };
try {
  for (let i = 0; i < 120; i++) { if (server.exitCode !== null) throw Error(output); try { if ((await fetch(`${origin}/login`)).ok) break; } catch {} await wait(200); }
  browser = await chromium.launch({ executablePath: process.env.BROWSER_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [], consoleErrors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/^Failed to load resource:/.test(message.text())) consoleErrors.push(message.text()); });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 401, json: { error: 'Войдите в Sellio.' } });
      return route.continue();
    });
    for (const path of ['/', '/pricing', '/register?plan=business', '/login', '/forgot-password', '/reset-password', '/onboarding', '/dashboard', '/orders', '/stock', '/settings', '/export']) {
      await page.goto(origin + path); await page.waitForTimeout(150);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      check(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(250, 248, 245)');
      check(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Plus Jakarta Sans')));
    }
    await page.goto(`${origin}/export`); await page.waitForURL('**/login'); await page.getByRole('heading', { name: 'Вход в кабинет' }).waitFor(); check(await page.getByRole('heading', { name: 'Вход в кабинет' }).isVisible());
    const email = page.getByLabel('Email', { exact: true });
    await email.focus();
    check(await email.evaluate(n => getComputedStyle(n).boxShadow !== 'none'));
    await page.keyboard.press('Tab');
    check(await page.getByLabel('Пароль', { exact: true }).evaluate(n => n === document.activeElement));
    await page.emulateMedia({ forcedColors: 'active' });
    await email.focus();
    check(await email.evaluate(n => getComputedStyle(n).outlineStyle), 'solid');
    check(await email.evaluate(n => getComputedStyle(n).outlineWidth), '2px');
    check(await email.evaluate(n => getComputedStyle(n).outlineColor !== 'rgba(0, 0, 0, 0)'));
    await page.emulateMedia({ forcedColors: 'none' });
    await page.goto(origin); await page.waitForTimeout(300); await page.getByRole('tab', { name: 'Заказы', exact: true }).click(); await page.locator('#features').getByText('Экспорт CSV / XLSX').waitFor(); check(await page.locator('#features').getByText('Экспорт CSV / XLSX').isVisible());
    await page.getByRole('tab', { name: 'Заказы', exact: true }).press('ArrowRight'); check((await page.getByRole('tab', { selected: true }).count()) === 1);
    await page.locator('#faq summary').first().click(); check(await page.locator('#faq details').first().evaluate(n => n.open));
    await page.locator('#demo-status').selectOption('completed'); await page.locator('#demo-city').selectOption('Алматы');
    check((await page.locator('#demo [aria-live]').innerText()).includes('2 заказов'));
    check(await page.locator('#demo tbody tr').count(), 2);
    await page.locator('#routine-hours').fill('0');
    check(await page.locator('#routine-hours').evaluate(n => n.value), '0');
    check((await page.locator('section').filter({ has: page.locator('#routine-hours') }).locator('[aria-live]').innerText()).includes('0 ч / год'));
    await page.locator('#routine-hours').fill('169');
    check(await page.getByRole('status').filter({ hasText: 'Введите конечные' }).isVisible());
    if (width === 375) { await page.getByRole('button', { name: 'Меню', exact: true }).click(); check(await page.getByRole('button', { name: 'Закрыть', exact: true }).isVisible()); await page.keyboard.press('Escape'); }
    check(errors.length, 0); check(consoleErrors.length, 0); await context.close();

    const privateContext = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const payload = { sub: 'mock-user', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' };
    const token = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.test-only`;
    await privateContext.addInitScript(({ token }) => localStorage.setItem('sb-sellio-test-auth-token', JSON.stringify({ access_token: token, refresh_token: 'mock-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id: 'mock-user', email: 'test@example.invalid', user_metadata: { name: 'Тестовый аккаунт' }, aud: 'authenticated' } })), { token });
    const app = await privateContext.newPage(), runtimeErrors = [], privateConsoleErrors = []; app.on('pageerror', e => runtimeErrors.push(e.message));
    app.on('console', message => { if (message.type() === 'error' && !/^Failed to load resource:/.test(message.text())) privateConsoleErrors.push(message.text()); });
    const period = defaultPeriod();
    const order = sanitizeOrder({ id: 'mock-order', order_code: 'MOCK-01', status: 'COMPLETED', updated_at: new Date().toISOString(), data: { kaspi: { creationDate: Date.now(), city: 'Алматы', totalPrice: 18000, deliveryCostForSeller: 0, entriesComplete: true, entries: [{ id: 'mock-entry', name: 'Тестовая лампа', offerCode: 'MOCK-LAMP', orderedQuantity: 1, unitType: 'PIECES', totalPrice: 18000 }] } } });
    const reports = buildReports([order], parseReportQuery(`http://localhost/?storeId=s1&start=${period.start}&end=${period.end}`));
    const stock = stockDto({ id: 'mock-stock', sku: 'MOCK-LAMP', model: 'Тестовая лампа', base_stock: 10, sold_since_base: 2, price: 18000, available: true, updated_at: new Date().toISOString() });
    let histories = [], failNext = false, holdNext = false, release, held, downloads = 0, holdHistory = false, releaseHistory, historyHeld = false, exportRequests = 0;
    app.on('download', () => { downloads++; });
    const json = (route, data, status = 200) => route.fulfill({ status, json: data });
    await app.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) {
        if (url.hostname === 'sellio-test.invalid' && url.pathname.includes('/logout')) return json(route, {});
        return route.abort();
      }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/stores') return json(route, { data: [{ id: 's1', name: 'Тестовый магазин', marketplace: 'kaspi' }, { id: 's2', name: 'Второй магазин', marketplace: 'kaspi' }] });
      if (url.pathname === '/api/settings/profile') return json(route, { data: { id: 'mock-user', name: 'Тестовый аккаунт', email: 'test@example.invalid', plan: 'starter', profileExists: true, nameSource: 'users' } });
      if (url.pathname === '/api/settings/stores') return json(route, { data: [{ id: 's1', name: 'Тестовый магазин', marketplace: 'kaspi', hasToken: false }] });
      const reportKind = { '/api/dashboard/summary': 'summary', '/api/dashboard/cities': 'cities', '/api/dashboard/top-sku': 'products', '/api/dashboard/revenue-by-day': 'revenue' }[url.pathname];
      if (reportKind) return json(route, { data: reports[reportKind] });
      if (url.pathname === '/api/kaspi/orders') return json(route, { data: [order], meta: { total: 1, page: 1, totalPages: 1, cities: ['Алматы'], warnings: [] } });
      if (url.pathname === '/api/stock') return json(route, { data: [stock], meta: { total: 1, totalPages: 1, page: 1, lowCount: 0, unknownCount: 0, threshold: 5 } });
      if (url.pathname === '/api/exports/history') {
        if (holdHistory) { holdHistory = false; historyHeld = true; await new Promise(resolve => { releaseHistory = resolve; }); return json(route, { data: [{ id: 'old', type: 'legacy', descriptor: null, author: 'PRIVATE_OLD_HISTORY', regenerable: false }], meta: { total: 1, totalPages: 1, page: 1 } }); }
        return json(route, { data: histories.slice(), meta: { total: histories.length, totalPages: histories.length ? 1 : 0, page: 1, pageSize: 20 } });
      }
      if (url.pathname === '/api/exports' || url.pathname.endsWith('/regenerate')) {
        exportRequests++;
        const descriptor = url.pathname.endsWith('/regenerate') ? histories.find(r => url.pathname.includes(`/${r.id}/`)).descriptor : request.postDataJSON();
        if (holdNext) { holdNext = false; held = true; await new Promise(resolve => { release = resolve; }); }
        if (failNext) { failNext = false; return json(route, { error: 'История недоступна; файл не выдан.' }, 503); }
        const file = makeExportFile(buildExportTable([], descriptor), descriptor);
        histories.unshift({ id: `h${histories.length + 1}`, createdAt: new Date().toISOString(), type: descriptor.report, descriptor, regenerable: true, author: 'Вы' });
        return route.fulfill({ status: 200, headers: { 'Content-Type': file.mime, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'X-Sellio-History-Saved': '1', 'X-Sellio-Order-Count': '0', 'X-Sellio-Row-Count': '0' }, body: file.bytes });
      }
      return json(route, { error: 'Mock route not provided' }, 503);
    });
    for (const [path, heading] of [['/dashboard', 'Dashboard'], ['/orders', 'Заказы маркетплейсов'], ['/stock', 'Управление остатками (SKU)'], ['/settings', 'Настройки системы']]) {
      await app.goto(origin + path); await app.getByRole('heading', { name: heading, exact: true }).waitFor(); await app.waitForTimeout(300);
      check(await app.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      check(await app.locator('[role="alert"]:not(#__next-route-announcer__)').count(), 0);
      if (path === '/dashboard') {
        await app.locator('.recharts-pie-sector').first().waitFor({ state: 'visible' });
        check((await app.locator('.recharts-wrapper').count()) >= 3);
        check((await app.locator('.recharts-surface path').count()) > 0);
        check((await app.locator('.recharts-pie-sector').count()) > 0);
      }
      if (path === '/settings') {
        await app.getByRole('tab', { name: 'Маркетплейсы', exact: true }).click();
        await app.getByRole('heading', { name: 'Тестовый магазин', exact: true }).waitFor();
        await app.getByRole('button', { name: 'Переподключить', exact: true }).click();
        check(await app.getByLabel('Новый API токен Kaspi').getAttribute('type'), 'password');
        check(await app.getByRole('button', { name: 'Проверить и сохранить', exact: true }).isDisabled());
      }
      if (artifacts) await app.screenshot({ path: `${artifacts}/${width}-${path.slice(1)}.png`, fullPage: true });
    }
    await app.goto(`${origin}/export`); await app.getByRole('heading', { name: 'Экспорт отчётов', exact: true }).waitFor();
    await app.getByText('В этой странице истории нет записей.', { exact: false }).waitFor();
    check(await app.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (artifacts) await app.screenshot({ path: `${artifacts}/${width}-export.png`, fullPage: true });
    const exportDate = app.getByLabel('Начало периода', { exact: true });
    await app.emulateMedia({ forcedColors: 'active' }); await exportDate.focus();
    check(await exportDate.evaluate(n => getComputedStyle(n).outlineStyle), 'solid');
    check(await exportDate.evaluate(n => getComputedStyle(n).outlineWidth), '2px');
    await app.emulateMedia({ forcedColors: 'none' });
    check(await app.getByRole('button', { name: 'Email', exact: true }).isDisabled()); check(await app.getByRole('button', { name: 'PDF', exact: true }).isDisabled()); check(await app.getByRole('button', { name: 'Google Sheets', exact: true }).isDisabled());
    await app.getByLabel('Начало периода', { exact: true }).fill('2026-10-01'); await app.getByLabel('Конец периода включительно').fill('2026-10-14');
    for (let i = 0; i < 3; i++) for (const [label, extension] of [['Скачать CSV', 'csv'], ['Скачать Excel (.xlsx)', 'xlsx']]) {
      const event = app.waitForEvent('download'); await app.getByRole('button', { name: label, exact: true }).nth(i).click(); const download = await event; check(download.suggestedFilename().endsWith(`.${extension}`)); await app.getByRole('status').filter({ hasText: 'Загрузка запрошена' }).waitFor();
    }
    check(histories.length, 6);
    const regenerated = app.waitForEvent('download'); await app.getByRole('button', { name: 'Сформировать заново', exact: true }).first().click(); await regenerated; check(histories.length, 7);
    failNext = true; const beforeFail = downloads; await app.getByRole('button', { name: 'Скачать CSV', exact: true }).first().click(); await app.getByRole('alert').filter({ hasText: 'История недоступна' }).waitFor(); check(downloads, beforeFail); check(histories.length, 7);
    holdNext = true; held = false; const beforeDouble = exportRequests;
    await app.getByRole('button', { name: 'Скачать CSV', exact: true }).first().evaluate(button => { button.click(); button.click(); });
    for (let i = 0; i < 50 && !held; i++) await wait(20);
    check(held); check(exportRequests, beforeDouble + 1); const beforeStale = downloads; await app.getByLabel('Город (точное название)').fill('Астана'); release(); await app.waitForTimeout(300); check(downloads, beforeStale); check(await app.getByRole('status').filter({ hasText: 'Загрузка запрошена' }).count(), 0);
    holdHistory = true; historyHeld = false; await app.getByRole('region', { name: 'История экспорта' }).getByRole('button', { name: 'Обновить', exact: true }).click();
    for (let i = 0; i < 50 && !historyHeld; i++) await wait(20);
    check(historyHeld); await app.getByLabel('Город (точное название)').fill('Алматы'); releaseHistory(); await app.waitForTimeout(300); check(await app.getByText('PRIVATE_OLD_HISTORY').count(), 0);
    await app.locator('header select').selectOption('s2'); await app.waitForTimeout(100); check(await app.getByRole('button', { name: 'Скачать CSV', exact: true }).first().isEnabled());
    if (width === 375) { check(await app.getByRole('navigation', { name: 'Мобильная навигация' }).getByRole('link', { name: 'Экспорт', exact: true }).isVisible()); await app.getByRole('button', { name: 'Открыть меню' }).click(); }
    holdNext = true; held = false;
    if (width === 375) await app.getByRole('button', { name: 'Закрыть меню' }).click();
    await app.getByRole('button', { name: 'Скачать CSV', exact: true }).first().click(); for (let i = 0; i < 50 && !held; i++) await wait(20);
    if (width === 375) await app.getByRole('button', { name: 'Открыть меню' }).click();
    await app.getByRole('button', { name: 'Выйти', exact: true }).click(); await app.waitForURL('**/login'); const beforeLogout = downloads; release(); await app.waitForTimeout(200); check(downloads, beforeLogout); check(runtimeErrors.length, 0);
    check(privateConsoleErrors.length, 0);
    await privateContext.close();

    const mockUser = { id: 'mock-user', email: 'test@example.invalid', aud: 'authenticated', role: 'authenticated', user_metadata: {} };
    const mockSession = { access_token: token, refresh_token: 'mock-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: mockUser };
    const mockAuth = async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.hostname !== 'sellio-test.invalid') return route.abort();
      if (url.pathname.endsWith('/token')) return json(route, mockSession);
      if (url.pathname.endsWith('/user')) return json(route, mockUser);
      if (url.pathname.endsWith('/logout')) return json(route, {});
      return route.abort();
    };
    for (const remember of [false, true]) {
      const authContext = await browser.newContext({ viewport: { width, height: 1000 } });
      const login = await authContext.newPage(); await login.route('**/*', mockAuth);
      await login.goto(`${origin}/login`); await login.getByLabel('Email', { exact: true }).fill('test@example.invalid');
      await login.getByLabel('Пароль', { exact: true }).fill('test-only-password');
      await login.getByLabel('Запомнить меня', { exact: true }).setChecked(remember);
      await login.getByRole('button', { name: 'Войти', exact: true }).click();
      await login.getByRole('heading', { name: 'Вы вошли в Sellio', exact: true }).waitFor();
      const saved = await login.evaluate(() => ({ local: localStorage.getItem('sb-sellio-test-auth-token'), session: sessionStorage.getItem('sb-sellio-test-auth-token') }));
      check(Boolean(saved[remember ? 'local' : 'session']));
      check(saved[remember ? 'session' : 'local'], null);
      check(!(saved.local ?? saved.session).includes('test-only-password'));
      await authContext.close();
    }
    const recoveryContext = await browser.newContext({ viewport: { width, height: 1000 } });
    const recovery = await recoveryContext.newPage(); await recovery.route('**/*', mockAuth);
    await recovery.goto(`${origin}/reset-password#access_token=${encodeURIComponent(token)}&refresh_token=mock-refresh&expires_in=3600&token_type=bearer&type=recovery`);
    await recovery.getByLabel('Новый пароль', { exact: true }).waitFor();
    check(await recovery.evaluate(() => window.location.hash), '');
    check(await recovery.getByRole('button', { name: 'Сохранить пароль', exact: true }).isEnabled());
    await recovery.getByLabel('Новый пароль', { exact: true }).fill('test-only-new-password');
    await recovery.getByLabel('Повторите пароль', { exact: true }).fill('test-only-new-password');
    await recovery.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
    await recovery.getByRole('heading', { name: 'Пароль обновлён', exact: true }).waitFor();
    check(await recovery.evaluate(() => window.location.hash), '');
    check(await recovery.getByRole('link', { name: 'Перейти ко входу', exact: true }).isVisible());
    await recovery.reload();
    await recovery.getByRole('heading', { name: 'Ссылка недействительна', exact: true }).waitFor();
    check(await recovery.getByLabel('Новый пароль', { exact: true }).count(), 0);
    await recoveryContext.close();
  }
  console.log(`Chromium browser passed: ${assertions} assertions at 375/1440; public/private gates, charts, focus/forced colors, demo/calculator, both remember modes, recovery save/reload, six formats, actual mock downloads, regeneration, failure, stale-filter/store/logout guards. All APIs mocked; no live credentials.`);
} catch (error) {
  console.error(output.slice(-8000));
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) console.error({ url: page.url(), text: (await page.locator('body').innerText()).slice(0, 2000) });
  throw error;
} finally { await browser?.close(); server.kill('SIGTERM'); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
