import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { credentialFingerprint, decryptToken, encryptToken, kaspiClient, KaspiError, KASPI_STATES, newRun, normalizeOrders, privateKey, readCursor, signCursor, validateCollection, WINDOW_MS } from '../lib/kaspi.js';
import { authenticate, persistOrders, syncPage, verifyStore } from '../lib/kaspiService.js';

const key = randomBytes(32);
const now = 1791028800000;
const owner = 'verified-user';
const storeId = 'local-default-id';
const token = 'test-placeholder-not-a-real-token';
const envelope = encryptToken(token, key);
const run = () => newRun(owner, storeId, envelope, now);
const order = (code = 'order-code', overrides = {}) => ({
  type: 'orders', id: 'opaque/kaspi/id', attributes: {
    code, status: 'COMPLETED', state: 'ARCHIVE', creationDate: now - 1000, totalPrice: 1200.5, ...overrides
  }, relationships: { entries: { data: [{ type: 'orderentries', id: 'entry-1' }] }, self: { links: { related: 'http://untrusted.invalid' } } }
});
const collection = (data = [], size = 100) => ({ data, included: [{ type: 'orderentries', id: 'entry-1', attributes: { quantity: 3, totalPrice: 1200.5 }, relationships: { product: { data: { id: 'master-id', type: 'masterproducts' } } } }], meta: { pageCount: Math.ceil(data.length / size), totalCount: data.length } });

// In-memory Supabase adapter: verifies real query ownership and conflict updates.
const database = () => {
  const rows = new Map();
  const calls = [];
  const stores = [{ id: storeId, name: 'Test store', marketplace: 'kaspi', user_id: owner, api_token_encrypted: envelope }];
  let nextError = null;
  const admin = {
    calls, rows, stores,
    fail(error) { nextError = error; },
    auth: { getUser: async (access) => ({ data: { user: access === 'valid-session' ? { id: owner } : null }, error: null }) },
    from(table) {
      const query = { table, filters: [], kind: 'read' }; calls.push(query);
      const api = {
        select(fields) { query.fields = fields; return api; },
        eq(field, value) { query.filters.push([field, value]); return api; },
        in(field, values) { query.values = [field, values]; return api; },
        order() { return api; }, range(start, end) { query.range = [start, end]; return api; },
        update(data) { query.kind = 'update'; query.data = data; return api; },
        insert(data) { query.kind = 'insert'; query.data = data; return api; },
        upsert(data, options) { query.kind = 'upsert'; query.data = data; query.options = options; return api; },
        single() { query.single = true; return api; }, maybeSingle() { query.single = true; return api; },
        then(resolve, reject) {
          try {
            if (nextError && table === 'orders') { const error = nextError; nextError = null; return Promise.resolve({ data: null, error }).then(resolve, reject); }
            let data;
            if (table === 'stores') {
              const matched = stores.filter((row) => query.filters.every(([field, value]) => String(row[field]) === value));
              if (query.kind === 'insert') { data = { id: 'generated-local-id', ...query.data }; stores.push(data); }
              else if (query.kind === 'update') { data = matched[0]; if (data) Object.assign(data, query.data); }
              else data = matched[0] ?? null;
            } else {
              assert.equal(table, 'orders', 'stock and users must not be touched');
              if (query.kind === 'upsert') {
                assert.equal(query.options.onConflict, 'store_id,order_code');
                for (const row of query.data) {
                  const id = `${row.store_id}:${row.order_code}`;
                  rows.set(id, { id: 'db-generated-id', comment: null, created_at: 'original-local-date', ...rows.get(id), ...row });
                }
                data = null;
              } else {
                data = [...rows.values()].filter((row) => query.filters.every(([field, value]) => (field === 'data->kaspi->>runId' ? row.data?.kaspi?.runId : row[field]) === value));
                if (query.values) data = data.filter((row) => query.values[1].includes(row[query.values[0]]));
                data.sort((a, b) => a.order_code.localeCompare(b.order_code));
                if (query.range) data = data.slice(query.range[0], query.range[1] + 1);
              }
            }
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        }
      };
      return api;
    }
  };
  return admin;
};

test('AES-GCM roundtrip uses fresh IVs, authenticated ciphertext and version', () => {
  const a = encryptToken(token, key), b = encryptToken(token, key);
  assert.notEqual(a, b); assert.match(a, /^v1\./); assert.equal(decryptToken(a, key), token);
  assert.throws(() => decryptToken(a, randomBytes(32)), KaspiError);
  assert.throws(() => decryptToken(a.replace('v1', 'v2'), key), KaspiError);
  const parts = a.split('.'); parts[3] = parts[3].slice(0, -2) + 'xx';
  assert.throws(() => decryptToken(parts.join('.'), key), KaspiError);
  assert.ok(!a.includes(token));
});
test('encryption configuration rejects missing, malformed and wrong length keys', () => {
  for (const encoded of ['', 'abc', randomBytes(16).toString('base64')]) assert.throws(() => privateKey(encoded), (e) => e.status === 503);
  assert.deepEqual(privateKey(key.toString('base64')), key);
});
test('cursor binds owner, store, frozen window, state, run and expiry', () => {
  const r = run(); const cursor = signCursor(r, key);
  assert.deepEqual(readCursor(cursor, key, owner, storeId, envelope, now), r);
  for (const [user, store, time] of [['attacker', storeId, now], [owner, 'other', now], [owner, storeId, now + 86400000]]) {
    assert.throws(() => readCursor(cursor, key, user, store, envelope, time), (e) => e.status === 409);
  }
  assert.throws(() => readCursor(cursor + 'x', key, owner, storeId, envelope, now));
  assert.throws(() => readCursor('x'.repeat(4097), key, owner, storeId, envelope, now));
  for (const change of [{ state: 7 }, { page: 1000 }, { start: now }, { end: now + 1 }, { runId: 'invalid' }]) {
    assert.throws(() => readCursor(signCursor({ ...r, ...change }, key), key, owner, storeId, envelope, now));
  }
});
test('verification uses documented constant URL, raw header, bounded ms dates and valid empty collection', async () => {
  let calls = 0;
  const mockFetch = async (url, options) => {
    calls += 1;
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://kaspi.kz'); assert.equal(parsed.pathname, '/shop/api/v2/orders');
    assert.equal(options.headers['X-Auth-Token'], token); assert.equal(options.headers['Content-Type'], 'application/vnd.api+json');
    assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    assert.equal(parsed.searchParams.get('page[number]'), '0'); assert.equal(parsed.searchParams.get('page[size]'), '100');
    assert.equal(parsed.searchParams.get('filter[orders][state]'), 'NEW');
    assert.equal(Number(parsed.searchParams.get('filter[orders][creationDate][$ge]')), now - WINDOW_MS);
    assert.equal(Number(parsed.searchParams.get('filter[orders][creationDate][$le]')), now);
    assert.equal(parsed.searchParams.get('include[orders]'), 'entries');
    return Response.json(collection());
  };
  assert.equal(await kaspiClient.verifyToken(token, mockFetch, now), true); assert.equal(calls, 1);
});
test('verification accepts 1001 NEW orders using one real 100-order first page', async () => {
  const firstPage = {
    ...collection(Array.from({ length: 100 }, (_, index) => ({ ...order(`code-${index}`), id: `resource-${index}` }))),
    meta: { pageCount: 11, totalCount: 1001 }
  };
  let calls = 0;
  assert.equal(await kaspiClient.verifyToken(token, async (url) => {
    calls += 1;
    const params = new URL(url).searchParams;
    assert.equal(params.get('page[number]'), '0'); assert.equal(params.get('page[size]'), '100');
    assert.equal(params.get('filter[orders][state]'), 'NEW');
    return Response.json(firstPage);
  }, now), true);
  assert.equal(firstPage.data.length, 100); assert.equal(calls, 1);
});
test('verification separates supported import limits from validity without weakening collection protections', async () => {
  const large = { ...collection(Array.from({ length: 100 }, (_, i) => order(String(i)))), meta: { pageCount: 1001, totalCount: 100001 } };
  assert.equal(await kaspiClient.verifyToken(token, async () => Response.json(large), now), true);
  await assert.rejects(kaspiClient.getOrders(token, { state: 'NEW', start: now - WINDOW_MS, end: now }, async () => Response.json(large)),
    (error) => error.status === 409 && error.message.includes('лимит импорта'));
  for (const malformed of [{ ...large, data: large.data.slice(1) },
    { ...large, data: [...large.data, order('extra')] }, { ...large, meta: undefined },
    { ...large, meta: { pageCount: 1000, totalCount: 100001 } },
    { ...large, meta: { pageCount: 1, totalCount: Number.MAX_SAFE_INTEGER + 1 } },
    { ...large, data: [order('bad', { creationDate: 'invalid' }), ...large.data.slice(1)] }]) {
    await assert.rejects(kaspiClient.verifyToken(token, async () => Response.json(malformed), now), KaspiError);
  }
});
test('every cursor requires SHA-256 of the exact stored envelope, never a raw-token fingerprint', () => {
  const r = run();
  assert.equal(r.credentialFingerprint, createHash('sha256').update(envelope, 'utf8').digest('hex'));
  assert.notEqual(r.credentialFingerprint, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(credentialFingerprint(envelope + ' '), r.credentialFingerprint, 'the envelope is not trimmed or canonicalized');
  assert.ok(!JSON.stringify(r).includes(token)); assert.ok(!JSON.stringify(r).includes(envelope));
  for (const fingerprint of [undefined, null, '', token, createHash('sha256').update(token).digest('hex')]) {
    const cursor = signCursor({ ...r, credentialFingerprint: fingerprint }, key);
    assert.throws(() => readCursor(cursor, key, owner, storeId, envelope, now),
      (error) => error.status === 409 && error.code === 'KASPI_RESTART_REQUIRED');
  }
  assert.throws(() => newRun(owner, storeId, undefined, now), KaspiError);
  assert.deepEqual(readCursor(signCursor(r, key), key, owner, storeId, envelope, now), r);
});
test('Kaspi auth failures differ from throttling, transient and malformed responses', async () => {
  const options = { state: 'NEW', start: now - WINDOW_MS, end: now };
  for (const status of [401, 403]) await assert.rejects(kaspiClient.getOrders(token, options, async () => new Response(token, { status })), (e) => e.status === 422 && !e.message.includes(token));
  let calls = 0;
  const result = await kaspiClient.getOrders(token, options, async () => { calls += 1; return calls < 3 ? new Response('secret upstream body', { status: 429, headers: { 'Retry-After': '0' } }) : Response.json(collection()); });
  assert.deepEqual(result, collection()); assert.equal(calls, 3);
  await assert.rejects(kaspiClient.getOrders(token, options, async () => new Response('private upstream', { status: 500 })), (e) => e.status === 503 && !e.message.includes('private'));
  await assert.rejects(kaspiClient.getOrders(token, options, async () => new Response('invalid json')), KaspiError);
  await assert.rejects(kaspiClient.getOrders(token, options, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))), KaspiError);
  await assert.rejects(kaspiClient.getOrders(token, { ...options, state: 'ALL' }), KaspiError);
});
test('pagination rejects missing meta, missing pages, malformed attributes and counts', () => {
  const good = collection([order()]); assert.equal(validateCollection(good, 0, 100), good);
  for (const bad of [{ data: [] }, { ...collection(), meta: { page_count: 0, total_count: 0 } },
    { ...collection(), meta: { pageCount: 2, totalCount: 1 } }, { ...good, data: [] },
    collection([order('x', { creationDate: 'yesterday' })]), collection([order('x', { totalPrice: '1200' })])]) {
    assert.throws(() => validateCollection(bad, 0, 100), KaspiError);
  }
  assert.throws(() => validateCollection(good, 1, 100), KaspiError);
});
test('normalization filters actual creationDate, deduplicates, links included IDs, preserves unknown statuses', () => {
  const current = order('same', { status: 'FUTURE_STATUS' });
  const raw = collection([current, current, order('old', { creationDate: now - WINDOW_MS - 1 }), order('future', { creationDate: now + 1 })]);
  raw.included.unshift({ type: 'orderentries', id: 'unrelated', attributes: { quantity: 900 } });
  const normalized = normalizeOrders(raw, run());
  assert.equal(normalized.length, 1); assert.equal(normalized[0].status, 'FUTURE_STATUS');
  assert.equal(normalized[0].kaspi.entries[0].orderedQuantity, 3);
  assert.equal(normalized[0].kaspi.entries[0].productId, 'master-id');
  assert.equal(normalized[0].kaspi.entriesComplete, true); assert.equal(normalized[0].kaspi.totalPrice, 1200.5);
  assert.ok(!('id' in normalized[0])); assert.ok(!('sku' in normalized[0].kaspi.entries[0]));
  raw.included = []; assert.equal(normalizeOrders(raw, run())[0].kaspi.entriesComplete, false);
});
test('server auth derives user from getUser and refuses unsigned/missing configuration', async () => {
  const admin = database();
  const request = (access) => new Request('http://localhost', { headers: access ? { Authorization: `Bearer ${access}` } : {} });
  assert.equal(await authenticate(request('valid-session'), admin), owner);
  await assert.rejects(authenticate(request(), admin), (e) => e.status === 401);
  await assert.rejects(authenticate(request('valid-session'), null), (e) => e.status === 503);
  await assert.rejects(authenticate(request('fake'), admin), (e) => e.status === 401);
});
test('verification creates a default-ID owner store only after upstream succeeds and returns public fields', async () => {
  const admin = database(); const input = { name: ' My store ', token, userId: 'attacker' };
  await assert.rejects(verifyStore({ admin, userId: owner, key, input, client: { verifyToken: async () => { throw new KaspiError('denied', 422); } } }));
  assert.equal(admin.stores.length, 1);
  const result = await verifyStore({ admin, userId: owner, key, input, client: { verifyToken: async () => true } });
  assert.deepEqual(result, { store: { id: 'generated-local-id', name: 'My store', connected: true } });
  const row = admin.stores[1]; assert.equal(row.user_id, owner); assert.equal(decryptToken(row.api_token_encrypted, key), token);
  assert.ok(!JSON.stringify(result).includes(token)); assert.ok(!JSON.stringify(result).includes('encrypted'));
});
test('every privileged store lookup enforces ownership before upstream/DB operations', async () => {
  const admin = database(); let called = false;
  const client = { verifyToken: async () => { called = true; }, getOrders: async () => { called = true; } };
  await assert.rejects(verifyStore({ admin, userId: 'attacker', key, input: { storeId, token, name: 'x' }, client }), (e) => e.status === 404);
  await assert.rejects(syncPage({ admin, userId: 'attacker', key, input: { storeId }, client, now }), (e) => e.status === 404);
  assert.equal(called, false);
  for (const call of admin.calls) assert.ok(call.filters.some(([field, value]) => field === 'user_id' && value === 'attacker'));
});
test('persistence preserves comments, local timestamps, IDs and independent data namespaces', async () => {
  const admin = database();
  admin.rows.set(`${storeId}:order-code`, { store_id: storeId, order_code: 'order-code', id: 17, comment: 'keep comment', created_at: 'keep date', data: { other: { note: 'keep' }, kaspi: { futureMetadata: 'keep' } } });
  const rows = normalizeOrders(collection([order()]), run());
  await persistOrders(admin, storeId, rows, now); await persistOrders(admin, storeId, rows, now);
  const saved = admin.rows.get(`${storeId}:order-code`);
  assert.equal(admin.rows.size, 1); assert.equal(saved.id, 17); assert.equal(saved.comment, 'keep comment'); assert.equal(saved.created_at, 'keep date');
  assert.deepEqual(saved.data.other, { note: 'keep' }); assert.equal(saved.data.kaspi.futureMetadata, 'keep');
  for (const call of admin.calls.filter((c) => c.kind === 'upsert')) for (const row of call.data) {
    for (const field of ['id', 'comment', 'created_at']) assert.ok(!(field in row));
  }
});
test('schema prerequisite and non-object metadata fail incomplete without leaking DB messages', async () => {
  const admin = database(); const rows = normalizeOrders(collection([order()]), run());
  admin.fail({ code: '42P10', message: 'private schema detail' });
  await assert.rejects(persistOrders(admin, storeId, rows, now), (e) => e.status === 409 && e.message.includes('store_id, order_code') && !e.message.includes('private'));
  admin.rows.set(`${storeId}:order-code`, { store_id: storeId, order_code: 'order-code', data: ['keep me'] });
  await assert.rejects(persistOrders(admin, storeId, rows, now), (e) => e.status === 409);
});
test('six-state bounded import freezes window and computes persisted unique real summary, not client counters', async () => {
  const admin = database(), states = []; let upstreamCalls = 0;
  const client = { getOrders: async (raw, options) => {
    upstreamCalls += 1; states.push(options.state); assert.equal(raw, token);
    assert.equal(options.start, now - WINDOW_MS); assert.equal(options.end, now); assert.equal(options.page, 0);
    return collection([order()]);
  } };
  let result = await syncPage({ admin, userId: owner, key, input: { storeId }, client, now });
  assert.equal(upstreamCalls, 0, 'initial cursor persists before any page can fail');
  for (let i = 0; i < 6; i += 1) {
    result = await syncPage({ admin, userId: owner, key, input: { storeId, cursor: result.cursor, orders: 9000 }, client, now });
    assert.equal(result.complete, false);
  }
  const finalCursor = result.cursor;
  result = await syncPage({ admin, userId: owner, key, input: { storeId, cursor: finalCursor }, client, now });
  assert.equal(result.complete, true); assert.deepEqual(states, KASPI_STATES); assert.equal(upstreamCalls, 6);
  assert.deepEqual(result.summary, { orders: 1, observedProducts: 1, entriesComplete: true, totalAmount: 1200.5, completedAmount: 1200.5, completedOrders: 1, stock: null, start: now - WINDOW_MS, end: now });
  assert.equal((await syncPage({ admin, userId: owner, key, input: { storeId, cursor: finalCursor }, client, now })).summary.orders, 1);
  assert.ok(admin.calls.filter((c) => c.table === 'orders').every((c) => c.kind === 'upsert' || c.filters.some(([f, v]) => f === 'store_id' && v === storeId)));
});
test('failed pages and persistence do not advance cursor; same-page retry is idempotent', async () => {
  const admin = database(), r = run(), cursor = signCursor(r, key);
  const input = { storeId, cursor };
  await assert.rejects(syncPage({ admin, userId: owner, key, input, client: { getOrders: async () => { throw new KaspiError('retry', 503); } }, now }));
  assert.equal(admin.rows.size, 0); assert.equal(readCursor(cursor, key, owner, storeId, envelope, now).page, 0);
  const client = { getOrders: async () => collection([order()]) };
  admin.fail({ code: '42P10' });
  await assert.rejects(syncPage({ admin, userId: owner, key, input, client, now }), (e) => e.status === 409);
  const first = await syncPage({ admin, userId: owner, key, input, client, now });
  const retry = await syncPage({ admin, userId: owner, key, input, client, now });
  assert.equal(first.cursor, retry.cursor); assert.equal(admin.rows.size, 1);
});
test('page cursor increments within a state and zero-order six-state import completes honestly', async () => {
  const admin = database(); let result = await syncPage({ admin, userId: owner, key, input: { storeId }, now });
  const client = { getOrders: async () => collection() };
  for (let i = 0; i < 7; i += 1) result = await syncPage({ admin, userId: owner, key, input: { storeId, cursor: result.cursor }, client, now });
  assert.equal(result.complete, true); assert.equal(result.summary.orders, 0); assert.equal(result.summary.stock, null);
  const r = run();
  const pageClient = { getOrders: async () => ({ ...collection(Array.from({ length: 100 }, (_, i) => order(String(i)))), meta: { pageCount: 2, totalCount: 101 } }) };
  const next = await syncPage({ admin, userId: owner, key, input: { storeId, cursor: signCursor(r, key) }, client: pageClient, now });
  const parsed = readCursor(next.cursor, key, owner, storeId, envelope, now);
  assert.equal(parsed.state, 0); assert.equal(parsed.page, 1);
});
test('seller A cursor cannot fetch/write after reconnecting the owned store to seller B; new B run starts at NEW', async () => {
  const admin = database();
  let result = await syncPage({ admin, userId: owner, key, input: { storeId }, now });
  result = await syncPage({ admin, userId: owner, key, input: { storeId, cursor: result.cursor }, now,
    client: { getOrders: async () => collection([order('seller-A', { state: 'NEW' })]) } });
  assert.equal(readCursor(result.cursor, key, owner, storeId, envelope, now).state, 1);
  const sellerB = 'test-placeholder-seller-B';
  await verifyStore({ admin, userId: owner, key, input: { storeId, name: 'Seller B', token: sellerB },
    client: { verifyToken: async (raw) => { assert.equal(raw, sellerB); return true; } } });
  const rowsBefore = structuredClone([...admin.rows]);
  admin.calls.length = 0;
  let fetches = 0;
  await assert.rejects(syncPage({ admin, userId: owner, key, input: { storeId, cursor: result.cursor }, now,
    client: { getOrders: async () => { fetches += 1; return collection([order('seller-B')]); } } }),
    (error) => error.status === 409 && error.code === 'KASPI_RESTART_REQUIRED' && !error.message.includes(sellerB));
  assert.equal(fetches, 0); assert.deepEqual([...admin.rows], rowsBefore);
  assert.ok(admin.calls.every((call) => call.table === 'stores'), 'no persistence or summary reads');
  const fresh = await syncPage({ admin, userId: owner, key, input: { storeId }, now });
  const freshRun = readCursor(fresh.cursor, key, owner, storeId, admin.stores[0].api_token_encrypted, now);
  assert.equal(freshRun.state, 0); assert.equal(freshRun.page, 0);
  assert.notEqual(freshRun.runId, readCursor(result.cursor, key, owner, storeId, envelope, now).runId);
  const next = await syncPage({ admin, userId: owner, key, input: { storeId, cursor: fresh.cursor }, now,
    client: { getOrders: async (raw, options) => { assert.equal(raw, sellerB); assert.equal(options.state, 'NEW'); return collection([order('seller-B')]); } } });
  assert.equal(next.complete, false);
});
test('finished cursor rejects changed credentials before any old-run summary or page fetch', async () => {
  const admin = database(), client = { getOrders: async () => collection([order()]) };
  let result = await syncPage({ admin, userId: owner, key, input: { storeId }, now });
  for (let i = 0; i < 6; i += 1) result = await syncPage({ admin, userId: owner, key, input: { storeId, cursor: result.cursor }, client, now });
  assert.equal(readCursor(result.cursor, key, owner, storeId, envelope, now).state, 6);
  await verifyStore({ admin, userId: owner, key, input: { storeId, name: 'Reconnected', token: 'test-placeholder-new-seller' },
    client: { verifyToken: async () => true } });
  admin.calls.length = 0;
  let fetches = 0;
  await assert.rejects(syncPage({ admin, userId: owner, key, input: { storeId, cursor: result.cursor }, now,
    client: { getOrders: async () => { fetches += 1; return collection(); } } }),
    (error) => error.status === 409 && error.code === 'KASPI_RESTART_REQUIRED');
  assert.equal(fetches, 0); assert.ok(admin.calls.every((call) => call.table === 'stores'));
});
test('reconnecting even an identical raw token creates a new envelope and invalidates previous cursors', async () => {
  const admin = database();
  const initial = await syncPage({ admin, userId: owner, key, input: { storeId }, now });
  await verifyStore({ admin, userId: owner, key, input: { storeId, name: 'Same seller', token }, client: { verifyToken: async () => true } });
  assert.notEqual(admin.stores[0].api_token_encrypted, envelope);
  assert.equal(decryptToken(admin.stores[0].api_token_encrypted, key), token);
  await assert.rejects(syncPage({ admin, userId: owner, key, input: { storeId, cursor: initial.cursor }, now }),
    (error) => error.status === 409 && error.code === 'KASPI_RESTART_REQUIRED');
});
test('credential reconnect while an upstream page is in flight rejects before persistence', async () => {
  const admin = database();
  const initial = await syncPage({ admin, userId: owner, key, input: { storeId }, now });
  let fetches = 0;
  await assert.rejects(syncPage({ admin, userId: owner, key, input: { storeId, cursor: initial.cursor }, now,
    client: { getOrders: async () => {
      fetches += 1;
      await verifyStore({ admin, userId: owner, key, input: { storeId, name: 'New connection', token: 'test-placeholder-reconnected' },
        client: { verifyToken: async () => true } });
      return collection([order('old-credential-page')]);
    } } }), (error) => error.status === 409 && error.code === 'KASPI_RESTART_REQUIRED');
  assert.equal(fetches, 1); assert.equal(admin.rows.size, 0);
  assert.ok(admin.calls.every((call) => call.table === 'stores'));
});
test('actual route and client restart path clear stale cursor, progress, summary and saved resume without verification', async () => {
  // Evaluate the unchanged handler body with injected imports, not a fake HTTP implementation.
  const source = fs.readFileSync(new URL('../lib/kaspiRoute.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export const handleKaspi', 'const handleKaspi');
  const handler = new Function('getSupabaseAdmin', 'KaspiError', 'privateKey', 'authenticate', `${source}\nreturn handleKaspi;`)
    (() => database(), KaspiError, () => key, authenticate);
  const request = () => new Request('http://localhost/api/kaspi/sync', {
    method: 'POST', headers: { Authorization: 'Bearer valid-session', 'Content-Type': 'application/json' }, body: '{}'
  });
  const response = await handler(request(), async () => { throw new KaspiError('Начните новый импорт.', 409, 'KASPI_RESTART_REQUIRED'); });
  assert.equal(response.status, 409); assert.equal(response.headers.get('cache-control'), 'no-store');
  const restartBody = await response.json();
  assert.deepEqual(restartBody, { error: 'Начните новый импорт.', code: 'KASPI_RESTART_REQUIRED' });
  const unknown = await handler(request(), async () => { const error = Error(token); error.code = token; throw error; });
  assert.equal(unknown.status, 503); assert.ok(!(await unknown.text()).includes(token));
  const browser = fs.readFileSync(new URL('../components/onboarding/OnboardingWizard.js', import.meta.url), 'utf8');
  // Run the component's actual request/import functions with mocked SDK, fetch and React setters.
  const alive = { current: true }, scope = { current: owner }, pending = { current: false }, pause = { current: true };
  const state = { cursor: 'old-cursor', progress: { completedStates: 6 }, summary: { orders: 999 }, step: 3 };
  let requests = 0;
  const requestCode = browser.slice(browser.indexOf('  const request ='), browser.indexOf('  const saveResume ='));
  const clientRequest = new Function('supabase', 'alive', 'scope', 'controller', 'setToken', 'router', 'fetch', `${requestCode}\nreturn request;`)
    ({ auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: 'valid-session' } } }) } }, alive, scope,
      { current: null }, () => {}, { replace: () => assert.fail('restart is not an auth redirect') }, async (path, options) => {
        requests += 1; assert.equal(path, '/api/kaspi/sync');
        assert.equal(JSON.parse(options.body).cursor, 'old-cursor');
        return Response.json(restartBody, { status: 409 });
      });
  const saved = new Map([[`sellio-kaspi-resume:${owner}`, 'old-resume']]);
  const importCode = browser.slice(browser.indexOf('  const importOrders ='), browser.indexOf('  const logout ='));
  const setter = (field) => (value) => { state[field] = value; };
  const importOrders = new Function('request', 'store', 'cursor', 'alive', 'pending', 'pause', 'scope', 'setPaused', 'setBusy', 'setError',
    'setCursor', 'setProgress', 'setSummary', 'setStep', 'saveResume', 'sessionStorage', `${importCode}\nreturn importOrders;`)
    (clientRequest, { id: storeId }, 'old-cursor', alive, pending, pause, scope, setter('paused'), setter('busy'), setter('error'),
      setter('cursor'), setter('progress'), setter('summary'), setter('step'), () => assert.fail('must not save a failed cursor'),
      { removeItem: (name) => saved.delete(name) });
  await importOrders();
  assert.equal(requests, 1, 'does not silently verify or automatically start a new run');
  assert.equal(state.cursor, null); assert.equal(state.progress, null); assert.equal(state.summary, null);
  assert.equal(state.step, 2); assert.equal(state.busy, null); assert.equal(state.paused, true);
  assert.equal(state.error, restartBody.error); assert.equal(saved.size, 0); assert.equal(pending.current, false);
});
test('source boundaries forbid client secrets, direct Kaspi calls and fake inventory updates', () => {
  const browser = fs.readFileSync(new URL('../components/onboarding/OnboardingWizard.js', import.meta.url), 'utf8');
  const publicAuth = fs.readFileSync(new URL('../lib/supabase.js', import.meta.url), 'utf8');
  assert.doesNotMatch(browser + publicAuth, /SUPABASE_SERVICE_ROLE_KEY|KASPI_TOKEN_ENCRYPTION_KEY|api_token_encrypted|kaspiClient|shop\/api\/v2/);
  assert.doesNotMatch(browser, /<button|localStorage|JSON\.stringify\(\{[^}]*token/s);
  assert.match(browser, /type="password"/); assert.match(browser, /setToken\(''\)/);
  const admin = fs.readFileSync(new URL('../lib/supabaseAdmin.js', import.meta.url), 'utf8');
  assert.match(admin, /import 'server-only'/);
  const service = fs.readFileSync(new URL('../lib/kaspiService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(service, /from\('stock'\)|from\('users'\)|CREATE TABLE|CREATE INDEX/);
});
