import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';
import { handleLocal, nextLocalVersion } from '../lib/localService.js';
import { stockDto } from '../lib/stockData.js';
import { encryptToken, decryptToken } from '../lib/kaspi.js';
import { verifyStore } from '../lib/kaspiService.js';
import { createRequestGate } from '../lib/reportView.js';

const rawVersion = '2026-10-01T00:00:00.000987+00:00';
const stock = (id = 'r1', changes = {}) => ({ id, store_id: 's1', sku: `SKU-${id}`, model: 'Товар', base_stock: 10, sold_since_base: 3, price: 0, available: true, updated_at: rawVersion, ...changes });
const newRow = { storeId: 's1', sku: 'New', model: 'Модель', baseStock: 0, price: 0, available: false };
const request = (method = 'GET', body, query = 'storeId=s1', auth = 'owner') => new Request(`http://localhost/api?${query}`, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
function database(rows = [stock()], options = {}) {
  const tables = { stock: rows, stores: [{ id: 's1', user_id: 'u1', name: 'Мой магазин', marketplace: 'kaspi', api_token_encrypted: 'PRIVATE_ENVELOPE', created_at: rawVersion }, { id: 's2', user_id: 'u1', name: 'Другой', marketplace: 'kaspi', api_token_encrypted: null }, { id: 'foreign', user_id: 'u2', marketplace: 'kaspi' }, { id: 'ozon', user_id: 'u1', marketplace: 'ozon' }], users: options.noProfile ? [] : [{ id: 'u1', name: 'Имя', email: 'STALE_DB_EMAIL', plan: 'paid-real' }], orders: [{ id: 'history', store_id: 's1' }] };
  const calls = [], writes = [];
  return { tables, calls, writes, auth: { getUser: async token => ({ data: { user: ['owner', 'other'].includes(token) ? { id: token === 'owner' ? 'u1' : 'u2', email: 'auth@example.test', user_metadata: { name: 'Fallback', plan: 'PRIVATE_FAKE_PLAN' } } : null } }) }, from(table) {
    const call = { table, conditions: [] }; calls.push(call); let update, upsert, range, limit, columns;
    const api = {
      select(value) { columns = value; call.columns = value; return this; }, eq(k, v) { call.conditions.push([k, v]); return this; }, is(k, v) { return this.eq(k, v); }, order() { return this; }, range(a, b) { range = [a, b]; return this; }, limit(n) { limit = n; return this; },
      update(value) { update = value; return this; }, upsert(value, config) { upsert = value; call.config = config; return this; },
      async maybeSingle() { const result = await this; return { ...result, data: result.data?.[0] ?? null }; },
      then(resolve, reject) {
        const execute = () => {
          if (options.error && (table === (options.errorTable ?? 'stock'))) return { data: null, error: { code: options.error, message: 'PRIVATE_DB_BODY' } };
          let found = tables[table].filter(row => call.conditions.every(([k, v]) => row[k] === v));
          const count = found.length;
          if (upsert) {
            assert.equal(call.config.onConflict, 'store_id,sku'); assert.equal(call.config.ignoreDuplicates, true);
            if (tables.stock.some(r => r.store_id === upsert.store_id && r.sku === upsert.sku)) found = [];
            else { const row = { id: `default-${tables.stock.length}`, ...upsert }; tables.stock.push(row); writes.push({ table, fields: upsert }); found = [row]; }
          }
          if (update) {
            if (options.conflict) found = [];
            else { for (const r of found) Object.assign(r, update); if (found.length) writes.push({ table, fields: update }); }
          }
          found = found.slice().sort((a, b) => a.id.localeCompare(b.id));
          if (range) found = found.slice(range[0], range[1] + 1);
          if (options.shortPage && range) found = found.slice(0, 500);
          if (limit) found = found.slice(0, limit);
          return { data: found.map(row => Object.fromEntries(columns.split(',').filter(k => k in row).map(k => [k, row[k]]))), error: null, count: options.noCount ? null : count };
        };
        return Promise.resolve().then(execute).then(resolve, reject);
      }
    }; return api;
  } };
}
const operationBody = kind => ({ storeId: 's1', id: 'r1', expectedUpdatedAt: rawVersion, ...(kind === 'rebase' ? { baseStock: 0, confirmed: true } : kind === 'set-price' ? { price: 0 } : { available: false }) });
for (const [kind, method, body, query] of [['stock', 'GET', undefined, 'storeId=s1'], ['stock', 'POST', newRow, ''], ...['rebase', 'set-price', 'toggle'].map(k => [k, 'POST', operationBody(k), '']), ['profile', 'GET', undefined, ''], ['profile', 'PATCH', { name: 'Name' }, ''], ['settings-stores', 'GET', undefined, ''], ['settings-stores', 'POST', { storeId: 's1', action: 'disconnect', confirmed: true }, '']]) {
  test(`${kind} ${method}: verified auth, safe config and private headers`, async () => {
    const unsigned = await handleLocal(request(method, body, query, ''), kind, database()); assert.equal(unsigned.status, 401); assert.match(unsigned.headers.get('cache-control'), /private, no-store/); assert.equal(unsigned.headers.get('vary'), 'Authorization');
    assert.equal((await handleLocal(request(method, body, query), kind, null)).status, 503);
    assert.equal((await handleLocal(request(method, body, query, 'invalid'), kind, database())).status, 401);
  });
}
for (const kind of ['stock', 'rebase', 'set-price', 'toggle']) {
  test(`${kind}: cross-owner, other marketplace and independent row/store scope`, async () => {
    const method = kind === 'stock' ? 'GET' : 'POST';
    for (const storeId of ['s1', 'ozon', 'foreign']) {
      const admin = database();
      const response = await handleLocal(request(method, method === 'POST' ? { ...operationBody(kind), storeId } : undefined, method === 'GET' ? `storeId=${storeId}` : '', storeId === 's1' ? 'other' : 'owner'), kind, admin);
      assert.equal(response.status, 404); assert.equal(admin.writes.length, 0); assert.equal(admin.calls.filter(c => c.table === 'stock').length, 0);
      assert.doesNotMatch(await response.text(), /PRIVATE|Мой магазин|SKU/);
    }
    if (kind !== 'stock') assert.equal((await handleLocal(request('POST', operationBody(kind), ''), kind, database([stock('r1', { store_id: 's2' })]))).status, 404);
  });
}
test('manual add independently denies other owner/store/marketplace', async () => {
  for (const [storeId, auth] of [['s1', 'other'], ['foreign', 'owner'], ['ozon', 'owner']]) {
    const admin = database(); assert.equal((await handleLocal(request('POST', { ...newRow, storeId }, '', auth), 'stock', admin)).status, 404); assert.equal(admin.writes.length, 0);
  }
});
test('stock DTO unknown fields are not zero; valid zero, zero base, negative balance and depletion', () => {
  const zero = stockDto(stock('zero', { base_stock: 0, sold_since_base: 0, price: 0, available: false })); assert.equal(zero.balance, 0); assert.equal(zero.price, 0); assert.equal(zero.available, false); assert.equal(zero.percent, null); assert.equal(zero.low, true);
  const negative = stockDto(stock('negative', { base_stock: 1, sold_since_base: 3 })); assert.equal(negative.balance, -2); assert.equal(negative.percent, 0);
  assert.equal(stockDto(stock('depleted', { sold_since_base: 10 })).percent, 0);
  for (const value of [null, undefined, '0', NaN, Infinity, true, -1, 0.5, 1000000001]) {
    const dto = stockDto(stock('bad', { base_stock: value, sold_since_base: value, available: value })); assert.equal(dto.base, null); assert.equal(dto.sold, null); assert.equal(dto.balance, null); if (typeof value !== 'boolean') assert.equal(dto.available, null);
  }
  for (const price of [null, undefined, '0', NaN, Infinity, true, -1, 1000000000001]) assert.equal(stockDto(stock('bad', { price })).price, null);
  assert.doesNotMatch(JSON.stringify(stockDto({ ...stock(), customer: 'PRIVATE', api_token_encrypted: 'PRIVATE' })), /PRIVATE|customer|api_token/);
});
test('complete >1000-row read, search and low/active counts across all pages', async () => {
  const rows = Array.from({ length: 1205 }, (_, i) => stock(String(i).padStart(5, '0'), { sku: i >= 1000 ? `Last-${i}` : `First-${i}`, base_stock: i >= 1000 ? 2 : 10, sold_since_base: 0, available: i >= 1000 }));
  const admin = database(rows);
  const result = await (await handleLocal(request('GET', undefined, 'storeId=s1&q=last&filter=low&page=3&pageSize=100'), 'stock', admin)).json();
  assert.equal(result.meta.total, 205); assert.equal(result.meta.lowCount, 205); assert.equal(result.meta.totalPages, 3); assert.equal(result.data.length, 5);
  const active = await (await handleLocal(request('GET', undefined, 'storeId=s1&filter=active'), 'stock', admin)).json(); assert.equal(active.meta.total, 205);
  assert.equal(admin.calls.filter(c => c.table === 'stock').length, 4);
});
test('cap and smaller Supabase row limits fail, never claim partial counts', async () => {
  assert.equal((await handleLocal(request(), 'stock', database(Array.from({ length: 10001 }, (_, i) => stock(String(i)))))).status, 409);
  for (const options of [{ shortPage: true }, { noCount: true }]) assert.equal((await handleLocal(request(), 'stock', database(Array.from({ length: 1205 }, (_, i) => stock(String(i))), options))).status, 503);
});
test('stock strict query rejects duplicates/date filters/owner and invalid pages', async () => {
  for (const suffix of ['&storeId=s2', '&start=2026-01-01', '&userId=u2', '&filter=unknown', '&page=0', '&pageSize=101', '&q=' + 'x'.repeat(101)]) assert.equal((await handleLocal(request('GET', undefined, 'storeId=s1' + suffix), 'stock', database())).status, 400);
});
test('manual add trims fields, uses ID defaults and sets only new baseline counter', async () => {
  const admin = database(); const response = await handleLocal(request('POST', { ...newRow, sku: ' New ', model: ' Модель ' }, ''), 'stock', admin); assert.equal(response.status, 200);
  const write = admin.writes[0].fields; assert.equal(write.sku, 'New'); assert.equal(write.sold_since_base, 0); assert.equal(write.base_stock, 0); assert.equal(write.available, false); assert.ok(!('id' in write)); assert.equal(admin.tables.stock[0].sold_since_base, 3);
});
test('duplicate SKU and simultaneous adds ignore duplicate without overwriting', async () => {
  const admin = database(), previous = JSON.stringify(admin.tables.stock[0]);
  const duplicate = await handleLocal(request('POST', { ...newRow, sku: 'SKU-r1' }, ''), 'stock', admin); assert.equal(duplicate.status, 409); assert.equal(JSON.stringify(admin.tables.stock[0]), previous);
  const responses = await Promise.all([1, 2].map(() => handleLocal(request('POST', newRow, ''), 'stock', admin))); assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(admin.writes.length, 1);
});
test('missing existing unique constraint is actionable 42P10 with no insert', async () => {
  const admin = database([], { error: '42P10' }); const response = await handleLocal(request('POST', newRow, ''), 'stock', admin); assert.equal(response.status, 409); assert.match((await response.json()).error, /stock\(store_id,sku\)/); assert.equal(admin.writes.length, 0);
});
test('manual add field/numeric/boolean bounds are strict and zero valid', async () => {
  const badInputs = [{ ...newRow, sku: '' }, { ...newRow, sku: 'x'.repeat(101) }, { ...newRow, model: 'x'.repeat(201) }, { ...newRow, userId: 'u2' }, { ...newRow, sold_since_base: 0 }, ...[null, '1', true, -1, 0.5, 1000000001].map(baseStock => ({ ...newRow, baseStock })), ...[null, '1', true, -1, 1000000000001].map(price => ({ ...newRow, price })), ...[null, 0, 1, 'true'].map(available => ({ ...newRow, available }))];
  for (const input of badInputs) { const admin = database(); assert.equal((await handleLocal(request('POST', input, ''), 'stock', admin)).status, 400); assert.equal(admin.writes.length, 0); }
});
for (const kind of ['rebase', 'set-price', 'toggle']) {
  test(`${kind}: changes only allowlisted target columns; preserves independent metadata`, async () => {
    const row = stock(), admin = database([row]); const result = await handleLocal(request('POST', operationBody(kind), ''), kind, admin); assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(admin.writes[0].fields).sort(), (kind === 'rebase' ? ['base_stock', 'sold_since_base', 'updated_at'] : kind === 'set-price' ? ['price', 'updated_at'] : ['available', 'updated_at']).sort());
    assert.equal(row.sku, 'SKU-r1'); assert.equal(row.model, 'Товар'); assert.equal(row.store_id, 's1'); if (kind !== 'rebase') { assert.equal(row.base_stock, 10); assert.equal(row.sold_since_base, 3); }
    else { assert.equal(row.base_stock, 0); assert.equal(row.sold_since_base, 0); }
  });
  test(`${kind}: stale/raw microsecond/null CAS with same and behind clocks`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(rawVersion) - 60000 });
    const row = stock(), admin = database([row]); assert.equal((await handleLocal(request('POST', operationBody(kind), ''), kind, admin)).status, 200);
    assert.equal(row.updated_at, '2026-10-01T00:00:00.001Z'); assert.ok(admin.calls.some(c => c.conditions.some(([k, v]) => k === 'updated_at' && v === rawVersion)));
    assert.equal((await handleLocal(request('POST', operationBody(kind), ''), kind, admin)).status, 409); assert.equal(admin.writes.length, 1);
    for (const updated_at of [null, 'PRIVATE_INVALID', undefined]) { const db = database([stock('r1', { updated_at })]); assert.equal((await handleLocal(request('POST', operationBody(kind), ''), kind, db)).status, 409); assert.equal(db.writes.length, 0); }
    assert.equal((await handleLocal(request('POST', operationBody(kind), ''), kind, database([stock()], { conflict: true }))).status, 409);
  });
  test(`${kind}: rejects extra columns, invalid version and bad values`, async () => {
    const bad = [{ ...operationBody(kind), expectedUpdatedAt: null }, { ...operationBody(kind), expectedUpdatedAt: 'PRIVATE_INVALID' }, { ...operationBody(kind), model: 'replacement' }, { ...operationBody(kind), store_id: 'foreign' }, { ...operationBody(kind), ...(kind === 'rebase' ? { baseStock: null } : kind === 'set-price' ? { price: null } : { available: 1 }) }];
    if (kind === 'rebase') bad.push({ ...operationBody(kind), confirmed: false });
    for (const input of bad) { const admin = database(); assert.equal((await handleLocal(request('POST', input, ''), kind, admin)).status, 400); assert.equal(admin.writes.length, 0); }
  });
}
test('monotonic version same clock and maximum successor fail safe', () => {
  assert.equal(nextLocalVersion(rawVersion, Date.parse(rawVersion)), '2026-10-01T00:00:00.001Z');
  for (const version of [null, 'bad', '1', '2026-10-01', '+275760-09-13T00:00:00.000Z']) assert.throws(() => nextLocalVersion(version), e => e.status === 503);
});
test('profile GET authoritative Auth email/users plan, flagged name fallback', async () => {
  const read = await (await handleLocal(request('GET', undefined, ''), 'profile', database())).json(); assert.equal(read.data.email, 'auth@example.test'); assert.equal(read.data.plan, 'paid-real'); assert.equal(read.data.nameSource, 'users'); assert.doesNotMatch(JSON.stringify(read), /PRIVATE|STALE_DB_EMAIL/);
  const fallback = await (await handleLocal(request('GET', undefined, ''), 'profile', database([], { noProfile: true }))).json(); assert.equal(fallback.data.nameSource, 'auth-metadata'); assert.equal(fallback.data.plan, null); assert.equal(fallback.data.profileExists, false);
});
test('profile PATCH only existing own users.name; cannot grant plan/email', async () => {
  for (const input of [{ name: 'New', plan: 'pro' }, { name: 'New', email: 'attacker@test' }, { name: 'New', id: 'u2' }, { name: '' }, { name: 'x'.repeat(101) }, { name: null }]) { const admin = database(); assert.equal((await handleLocal(request('PATCH', input, ''), 'profile', admin)).status, 400); assert.equal(admin.writes.length, 0); }
  const admin = database(); assert.equal((await handleLocal(request('PATCH', { name: ' New ' }, ''), 'profile', admin)).status, 200); assert.deepEqual(admin.writes[0].fields, { name: 'New' }); assert.equal(admin.tables.users[0].plan, 'paid-real');
  assert.equal((await handleLocal(request('PATCH', { name: 'New' }, '', 'other'), 'profile', admin)).status, 409);
  assert.equal((await handleLocal(request('PATCH', { name: 'New' }, ''), 'profile', database([], { noProfile: true }))).status, 409);
});
test('settings store list public allowlist has no credential/cipher/PII/suffix', async () => {
  const response = await handleLocal(request('GET', undefined, ''), 'settings-stores', database()); const text = await response.text(); assert.doesNotMatch(text, /PRIVATE|api_token|user_id|foreign|ozon/); const rows = JSON.parse(text).data; assert.equal(rows.length, 2); assert.equal(rows[0].hasToken, true); assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'name', 'marketplace', 'createdAt', 'hasToken'].sort());
});
test('disconnect clears only own envelope and retains ID, store, all orders and stock', async () => {
  const admin = database(); const history = JSON.stringify({ orders: admin.tables.orders, stock: admin.tables.stock });
  const response = await handleLocal(request('POST', { storeId: 's1', action: 'disconnect', confirmed: true }, ''), 'settings-stores', admin); assert.equal(response.status, 200); assert.equal(admin.tables.stores[0].api_token_encrypted, null); assert.equal(admin.tables.stores[0].id, 's1'); assert.equal(admin.tables.stores[0].name, 'Мой магазин'); assert.equal(JSON.stringify({ orders: admin.tables.orders, stock: admin.tables.stock }), history); assert.deepEqual(admin.writes[0].fields, { api_token_encrypted: null }); assert.ok(admin.calls.some(c => c.conditions.some(([k, v]) => k === 'api_token_encrypted' && v === 'PRIVATE_ENVELOPE')));
  assert.equal((await handleLocal(request('POST', { storeId: 's1', action: 'disconnect', confirmed: true }, ''), 'settings-stores', admin)).status, 200);
});
test('disconnect confirmation, ownership, CAS and nonnullable schema errors are safe', async () => {
  for (const body of [{ storeId: 's1', action: 'disconnect' }, { storeId: 's1', action: 'disconnect', confirmed: true, cascade: true }]) assert.equal((await handleLocal(request('POST', body, ''), 'settings-stores', database())).status, 400);
  const input = { storeId: 's1', action: 'disconnect', confirmed: true };
  assert.equal((await handleLocal(request('POST', input, '', 'other'), 'settings-stores', database())).status, 404);
  for (const [options, status] of [[{ conflict: true }, 409], [{ error: '23502', errorTable: 'stores' }, 503]]) { const admin = database([stock()], options); const response = await handleLocal(request('POST', input, ''), 'settings-stores', admin); assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /PRIVATE|23502|api_token/); assert.equal(admin.tables.stores[0].api_token_encrypted, 'PRIVATE_ENVELOPE'); }
});
test('stored token check uses server decrypt/verifier, no persistence or raw response', async () => {
  const key = randomBytes(32), admin = database(); admin.tables.stores[0].api_token_encrypted = encryptToken('test-placeholder-only', key);
  const old = process.env.KASPI_TOKEN_ENCRYPTION_KEY; process.env.KASPI_TOKEN_ENCRYPTION_KEY = key.toString('base64');
  try {
    let called = 0; const response = await handleLocal(request('POST', { storeId: 's1', action: 'check' }, ''), 'settings-stores', admin, { verifyToken: async token => { assert.equal(token, 'test-placeholder-only'); called++; } });
    assert.equal(response.status, 200); assert.equal(called, 1); assert.equal(admin.writes.length, 0); const result = await response.json(); assert.equal(result.data.connected, true); assert.ok(Number.isFinite(Date.parse(result.data.checkedAt))); assert.doesNotMatch(JSON.stringify(result), /placeholder|v1\.|api_token/);
    assert.equal((await handleLocal(request('POST', { storeId: 's1', action: 'check' }, '', 'other'), 'settings-stores', admin)).status, 404);
    delete process.env.KASPI_TOKEN_ENCRYPTION_KEY; assert.equal((await handleLocal(request('POST', { storeId: 's1', action: 'check' }, ''), 'settings-stores', admin)).status, 503);
  } finally { if (old === undefined) delete process.env.KASPI_TOKEN_ENCRYPTION_KEY; else process.env.KASPI_TOKEN_ENCRYPTION_KEY = old; }
});
test('check and reconnect cannot apply old result over changed credential', async () => {
  const key = randomBytes(32), admin = database(), old = process.env.KASPI_TOKEN_ENCRYPTION_KEY;
  process.env.KASPI_TOKEN_ENCRYPTION_KEY = key.toString('base64'); admin.tables.stores[0].api_token_encrypted = encryptToken('test-placeholder-old', key);
  try {
    const check = await handleLocal(request('POST', { storeId: 's1', action: 'check' }, ''), 'settings-stores', admin, { verifyToken: async () => { admin.tables.stores[0].api_token_encrypted = encryptToken('test-placeholder-raced', key); } }); assert.equal(check.status, 409);
    await assert.rejects(verifyStore({ admin, userId: 'u1', key, input: { storeId: 's1', name: 'Reconnect', token: 'test-placeholder-new' }, client: { verifyToken: async () => { admin.tables.stores[0].api_token_encrypted = encryptToken('test-placeholder-raced-again', key); } } }), e => e.status === 409);
    assert.equal(admin.writes.length, 0);
    admin.tables.stores[0].api_token_encrypted = null;
    await verifyStore({ admin, userId: 'u1', key, input: { storeId: 's1', name: 'Reconnect', token: 'test-placeholder-new' }, client: { verifyToken: async () => {} } });
    assert.equal(decryptToken(admin.tables.stores[0].api_token_encrypted, key), 'test-placeholder-new'); assert.equal(admin.tables.stock[0].sold_since_base, 3); assert.equal(admin.tables.orders.length, 1);
  } finally { if (old === undefined) delete process.env.KASPI_TOKEN_ENCRYPTION_KEY; else process.env.KASPI_TOKEN_ENCRYPTION_KEY = old; }
});
test('bounded JSON body, content type, whitelist and safe database errors', async () => {
  assert.equal((await handleLocal(request('POST', { ...newRow, model: 'x'.repeat(17000) }, ''), 'stock', database())).status, 413);
  assert.equal((await handleLocal(new Request('http://localhost', { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: '{bad' }), 'stock', database())).status, 400);
  assert.equal((await handleLocal(request('POST', undefined, ''), 'stock', database())).status, 415);
  const response = await handleLocal(request(), 'stock', database([stock()], { error: 'PRIVATE' })); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE/);
});
test('actual new routes have only intended methods and delegate to protected service', () => {
  for (const [path, kind, methods] of [['stock', 'stock', ['GET', 'POST']], ['stock/rebase', 'rebase', ['POST']], ['stock/set-price', 'set-price', ['POST']], ['stock/toggle', 'toggle', ['POST']], ['settings/profile', 'profile', ['GET', 'PATCH']], ['settings/stores', 'settings-stores', ['GET', 'POST']]]) {
    const source = fs.readFileSync(`app/api/${path}/route.js`, 'utf8'), calls = [], admin = {};
    assert.match(source, /force-dynamic/); assert.match(source, /supabaseAdmin/);
    const context = vm.createContext({ getSupabaseAdmin: () => admin, handleLocal: (...args) => { calls.push(args); return { status: 401 }; } }); vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/export const /g, 'var '), context);
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) { if (!methods.includes(method)) assert.equal(context[method], undefined); else { const req = request(); assert.equal(context[method](req).status, 401); assert.deepEqual(calls.at(-1), [req, kind, admin]); } }
  }
});
test('client source owner/store identity, token-memory, profile refresh, no fake schedulers', () => {
  const stock = fs.readFileSync('components/stock/Stock.js', 'utf8'), settings = fs.readFileSync('components/settings/Settings.js', 'utf8');
  assert.match(stock, /key=\{`\$\{session.user.id\}:\$\{session.access_token\}:\$\{storeId\}`\}/); assert.match(settings, /app.storeId/); assert.match(settings, /setToken\(''\)/); assert.match(settings, /type="password"/); assert.doesNotMatch(settings, /localStorage|sessionStorage|api_token_encrypted/);
  assert.match(settings, /saved=\{refreshProfile\}/); assert.match(fs.readFileSync('components/shell/AppContext.js', 'utf8'), /profile=\{profile\}/);
  const hook = fs.readFileSync('components/shell/useResource.js', 'utf8'), mutation = fs.readFileSync('components/shell/useMutation.js', 'utf8'); assert.match(hook, /state.scope === scope/); assert.match(hook, /request.current\(\)/); assert.match(mutation, /gate.current.cancel\(\)/); assert.match(mutation, /signal: request.signal/);
  for (const path of ['app/(app)/stock/page.js', 'app/(app)/settings/page.js']) assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /<button|style=/);
  const gate = createRequestGate(), first = gate.begin(); gate.cancel(); assert.equal(first.current(), false); assert.equal(first.signal.aborted, true);
});
