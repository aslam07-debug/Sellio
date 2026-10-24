import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { handleExport } from '../lib/exportService.js';
import { validateExport, parseExportPeriod, buildExportTable, exportGroupKey, descriptorQuery } from '../lib/exportData.js';
import { makeExportFile } from '../lib/exportFile.js';
import { midnight, filterOrders, csvCell } from '../lib/reportData.js';
import { createRequestGate } from '../lib/reportView.js';
import { exportContextKey, exportPreset } from '../lib/exportView.js';

const spec = (changes = {}) => ({ version: 1, report: 'orders', format: 'csv', storeIds: ['s1'], start: '2026-09-30', end: '2026-10-14', status: '', city: '', q: '', group: 'day', sort: 'amount', ...changes });
const row = (id = '1', store = 's1', changes = {}) => ({ id, store_id: store, order_code: `O-${id}`, status: 'COMPLETED', data: { private: 'PRIVATE_DATA', kaspi: { creationDate: midnight('2026-10-01'), city: 'Алматы', totalPrice: 0, deliveryCostForSeller: 0, entriesComplete: true, customer: { name: 'PRIVATE_NAME', phone: 'PRIVATE_PHONE' }, deliveryAddress: { street: 'PRIVATE_STREET', coordinates: 'PRIVATE_COORD' }, recipient: 'PRIVATE_RECIPIENT', waybill: 'PRIVATE_WAYBILL', entries: [{ id: `e${id}`, productId: 'master1', name: 'Товар', orderedQuantity: 1, unitType: 'PIECES', totalPrice: 0, secret: 'PRIVATE_ENTRY' }], ...changes } }, comment: 'PRIVATE_COMMENT' });
function mock({ rows = [row()], history = [], stores = [{ id: 's1', user_id: 'u1', marketplace: 'kaspi', name: 'Магазин' }, { id: 's2', user_id: 'u1', marketplace: 'kaspi', name: 'Другой' }, { id: 'foreign', user_id: 'u2', marketplace: 'kaspi', name: 'PRIVATE_STORE' }], failure = '', rowLimit, changingCount = false } = {}) {
  const reads = [], writes = []; let orderReads = 0;
  return { reads, writes, rows, history, stores, auth: { getUser: async token => ({ data: { user: ['owner', 'other'].includes(token) ? { id: token === 'owner' ? 'u1' : 'u2', user_metadata: { role: 'admin' } } : null } }) }, from(table) {
    const conditions = []; let range, insert, fields, sort = [];
    const q = {
      select(value) { fields = value; return this; }, eq(k, v) { conditions.push([k, v]); return this; }, order(k, options) { sort.push([k, options]); return this; }, range(a, b) { range = [a, b]; return this; }, insert(value) { insert = value; return this; },
      async maybeSingle() { const r = await this; return { ...r, data: r.data?.[0] ?? null }; },
      then(resolve, reject) {
        reads.push({ table, fields, conditions: [...conditions] });
        if (failure === table) return Promise.resolve({ error: { message: 'PRIVATE_SQL service_role=PRIVATE_KEY', code: 'PRIVATE_CONSTRAINT' }, data: null }).then(resolve, reject);
        if (insert) { writes.push(insert); history.push({ ...insert, id: `h${history.length + 1}`, created_at: '2026-10-14T01:00:00Z' }); return Promise.resolve({ data: [{ id: history.at(-1).id }], error: null }).then(resolve, reject); }
        const source = table === 'stores' ? stores : table === 'orders' ? rows : history;
        let data = source.filter(r => conditions.every(([k, v]) => String(r[k]) === String(v))), count = data.length;
        if (table === 'orders' && changingCount && ++orderReads > 1) count += 1;
        for (const [k, options] of sort.slice().reverse()) data = data.slice().sort((a, b) => String(a[k]).localeCompare(String(b[k])) * (options.ascending ? 1 : -1));
        if (range) data = data.slice(range[0], range[1] + 1);
        if (rowLimit) data = data.slice(0, rowLimit);
        return Promise.resolve({ data, count, error: null }).then(resolve, reject);
      }
    }; return q;
  } };
}
const req = (action = 'create', input = spec(), token = 'owner', method, query = '') => new Request(`http://localhost/api/exports${query}`, { method: method ?? (action === 'history' ? 'GET' : 'POST'), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...((method ?? (action === 'history' ? 'GET' : 'POST')) === 'GET' ? {} : { body: JSON.stringify(input) }) });
const run = (admin, input = spec()) => handleExport(req('create', input), 'create', admin);
const decode = async response => XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
const sanitized = (rows, descriptor = spec()) => filterOrders(rows, descriptorQuery(descriptor)).map(o => ({ ...o, storeId: 's1', storeName: 'Магазин' }));

test('export descriptor strict fields, types, dates, bounds, formats and duplicate stores', () => {
  for (const changes of [{ user_id: 'u2' }, { report: 'sql' }, { format: 'pdf' }, { version: 2 }, { storeIds: [] }, { storeIds: ['s1', 's1'] }, { storeIds: Array.from({ length: 11 }, (_, i) => `s${i}`) }, { storeIds: [' x'] }, { start: '2026-02-29' }, { end: '2026-11-01' }, { start: false }, { q: false }, { q: 'x'.repeat(101) }, { city: 'a\0b' }, { status: 'COMPLETED' }, { group: 'year' }, { sort: 'profit' }]) assert.throws(() => validateExport(spec(changes)));
  assert.doesNotThrow(() => validateExport(spec({ start: '2026-09-14' })));
  assert.throws(() => validateExport(spec({ start: '2026-09-13' })));
  assert.deepEqual(validateExport(spec({ storeIds: ['s2', 's1'] })).storeIds, ['s1', 's2']);
});
test('history versioned string/object and legacy invalid values never execute', () => {
  for (const period of [spec(), JSON.stringify(spec())]) assert.deepEqual(parseExportPeriod(period, 'orders'), spec());
  for (const period of ['last month', '{', null, [], false, { ...spec(), version: 0 }, { ...spec(), user_id: 'u2' }, 'x'.repeat(20000)]) assert.equal(parseExportPeriod(period, 'orders'), null);
  assert.equal(parseExportPeriod(spec(), 'finance'), null);
});
test('Almaty historical offset, Monday week and cross-year/month groups', () => {
  assert.equal(exportGroupKey(midnight('2026-10-05') - 1, 'week'), '2026-09-28');
  assert.equal(exportGroupKey(midnight('2026-10-05'), 'week'), '2026-10-05');
  assert.equal(exportGroupKey(midnight('2027-01-01'), 'week'), '2026-12-28');
  assert.equal(exportGroupKey(midnight('2026-10-01') - 1, 'month'), '2026-09');
  assert.equal(exportGroupKey(midnight('2023-06-01'), 'day'), '2023-06-01');
  assert.deepEqual(exportPreset('previous', midnight('2026-03-01')), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(exportPreset('month', midnight('2026-10-14')), { start: '2026-10-01', end: '2026-10-14' });
  assert.deepEqual(exportPreset('last14', midnight('2026-10-14')), { start: '2026-10-01', end: '2026-10-14' });
  assert.equal(exportPreset('90days'), null);
});
for (const action of ['create', 'history', 'regenerate']) test(`${action}: anonymous/config/bad bearer/method and safe private headers`, async () => {
  const admin = mock();
  assert.equal((await handleExport(req(action, {}, ''), action, admin, 'h1')).status, 401);
  assert.equal((await handleExport(req(action, {}, 'bad'), action, admin, 'h1')).status, 401);
  const config = await handleExport(req(action), action, null, 'h1'); assert.equal(config.status, 503); assert.doesNotMatch(await config.text(), /PRIVATE|KEY|owner/);
  const method = action === 'history' ? 'POST' : 'GET';
  const invalid = await handleExport(req(action, {}, '', method), action, admin, 'h1'); assert.equal(invalid.status, 405); assert.equal(invalid.headers.get('allow'), action === 'history' ? 'GET' : 'POST'); assert.match(invalid.headers.get('cache-control'), /private, no-store/); assert.equal(invalid.headers.get('vary'), 'Authorization');
  assert.equal(admin.reads.length, 0);
});
for (const format of ['csv', 'xlsx']) for (const report of ['orders', 'finance', 'products']) test(`${report}/${format}: cross-owner rejected before order reads; verified getUser owner only`, async () => {
  const admin = mock();
  const denied = await handleExport(req('create', spec({ format, report }), 'other'), 'create', admin);
  assert.equal(denied.status, 404); assert.doesNotMatch(await denied.text(), /PRIVATE|O-1/);
  assert.equal(admin.reads.filter(r => r.table === 'orders').length, 0); assert.equal(admin.writes.length, 0);
  const ok = await run(admin, spec({ format, report })); assert.equal(ok.status, 200); assert.equal(admin.writes[0].user_id, 'u1');
});
test('all-own stores retain equal order codes, foreign store rejects whole request before reads', async () => {
  const admin = mock({ rows: [row('1'), row('1', 's2')] });
  const response = await run(admin, spec({ storeIds: ['s1', 's2'] })); assert.equal(response.status, 200); assert.equal(response.headers.get('x-sellio-order-count'), '2');
  const csv = await response.text(); assert.match(csv, /Магазин/); assert.match(csv, /Другой/);
  const invalid = mock(); assert.equal((await run(invalid, spec({ storeIds: ['s1', 'foreign'] }))).status, 404); assert.equal(invalid.reads.filter(r => r.table === 'orders').length, 0); assert.equal(invalid.writes.length, 0);
});
for (const format of ['csv', 'xlsx']) test(`${format}: complete 1205-row export and filters across every page`, async () => {
  const rows = Array.from({ length: 1205 }, (_, i) => row(String(i).padStart(5, '0'), 's1', { city: i > 1000 ? 'Астана' : 'Алматы' }));
  const all = await run(mock({ rows }), spec({ format })); assert.equal(all.status, 200); assert.equal(all.headers.get('x-sellio-row-count'), '1205');
  const filtered = await run(mock({ rows }), spec({ format, city: 'Астана', status: 'completed', q: 'O-' })); assert.equal(filtered.status, 200); assert.equal(filtered.headers.get('x-sellio-order-count'), '204');
  if (format === 'xlsx') { const book = await decode(all); assert.equal(XLSX.utils.sheet_to_json(book.Sheets.Report).length, 1205); }
  else assert.equal((await all.text()).split('\r\n').length, 1206);
});
test('combined scan cap exactly 10000 succeeds, cap+1 fails without bytes or history', async () => {
  const rows = Array.from({ length: 10000 }, (_, i) => row(String(i).padStart(5, '0'), i < 5000 ? 's1' : 's2'));
  const input = spec({ storeIds: ['s1', 's2'] });
  const success = await run(mock({ rows }), input); assert.equal(success.status, 200); assert.equal(success.headers.get('x-sellio-row-count'), '10000');
  const admin = mock({ rows: [...rows, row('extra', 's2')] }); const failure = await run(admin, input); assert.equal(failure.status, 413); assert.equal(failure.headers.get('content-disposition'), null); assert.equal(admin.writes.length, 0);
});
test('lower DB row limit, duplicate IDs and count changes fail safely without partial files', async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => row(String(i)));
  for (const options of [{ rows, rowLimit: 100 }, { rows, changingCount: true }, { rows: [row(), row()] }]) {
    const admin = mock(options); const response = await run(admin); assert.ok([409, 503].includes(response.status)); assert.equal(admin.writes.length, 0);
  }
});
test('zero orders has headers, explicit metadata 0 and successful history, never fabricated orders', async () => {
  for (const format of ['csv', 'xlsx']) {
    const admin = mock({ rows: [] }); const response = await run(admin, spec({ format })); assert.equal(response.status, 200); assert.equal(response.headers.get('x-sellio-row-count'), '0'); assert.equal(response.headers.get('x-sellio-order-count'), '0'); assert.equal(admin.writes.length, 1);
    if (format === 'xlsx') { const book = await decode(response); assert.equal(XLSX.utils.sheet_to_json(book.Sheets.Report).length, 0); assert.ok(XLSX.utils.sheet_to_json(book.Sheets.Metadata).some(r => r.Поле === 'Заказов' && r.Значение === 0)); }
    else { const csv = await response.text(); assert.match(csv, /Метаданные: Заказов/); assert.equal(csv.split('\r\n').length, 2); }
  }
});
test('financial scope, true zero, missing values/AOV and availability never invented profit', () => {
  const input = spec({ report: 'finance' }), rows = [row('1'), row('2', 's1', { totalPrice: null, deliveryCostForSeller: null }), row('3', 's1', { totalPrice: 200 }), { ...row('4', 's1', { totalPrice: 999 }), status: 'CANCELLED' }];
  const table = buildExportTable(sanitized(rows, input), input);
  assert.deepEqual(table.rows[0].slice(2), [3, null, 200, 1, 100, null, 1, null, null]);
  const zero = buildExportTable(sanitized([row()], input), input); assert.deepEqual(zero.rows[0].slice(2), [1, 0, 0, 0, 0, 0, 0, null, null]);
  const book = XLSX.read(makeExportFile(zero, { ...input, format: 'xlsx' }).bytes, { type: 'buffer' }); assert.equal(book.Sheets.Report.D2.t, 'n'); assert.equal(book.Sheets.Report.D2.v, 0); assert.equal(book.Sheets.Report.J2, undefined);
  assert.match(JSON.stringify(table.metadata), /не выплаты Kaspi|недоступны/);
});
test('financial day/week/month grouping uses order totals once, across two months', () => {
  const rows = [row('1', 's1', { creationDate: midnight('2026-09-30'), totalPrice: 100 }), row('2', 's1', { creationDate: midnight('2026-10-01'), totalPrice: 200 })];
  for (const [group, length] of [['day', 2], ['week', 1], ['month', 2]]) { const descriptor = spec({ report: 'finance', group }); const table = buildExportTable(sanitized(rows, descriptor), descriptor); assert.equal(table.rows.length, length); assert.equal(table.rows.reduce((n, r) => n + r[3], 0), 300); }
});
test('product aggregation has all products, unit-aware codes, null quantity and stable sorts', () => {
  const entries = [{ id: 'a', productId: 'catalog', name: 'А', orderedQuantity: 2, unitType: 'PIECES', totalPrice: 20 }, { id: 'b', productId: 'catalog', name: 'А', orderedQuantity: 0.5, unitType: 'WEIGHT_VOLUME', totalPrice: 30 }, { id: 'c', offerCode: 'offer', name: 'Б', orderedQuantity: null, totalPrice: null }, ...Array.from({ length: 12 }, (_, i) => ({ productId: `p${i}`, name: `Товар${i}`, orderedQuantity: 1, unitType: 'PIECES', totalPrice: 1 }))];
  for (const sort of ['name', 'amount', 'quantity']) {
    const input = spec({ report: 'products', sort }), table = buildExportTable(sanitized([row('1', 's1', { totalPrice: 9999, entries })], input), input);
    assert.equal(table.rows.length, 15); const catalog = table.rows.filter(r => r[2] === 'catalog'); assert.equal(catalog.length, 2); assert.deepEqual(catalog.map(r => r[4]).sort(), ['PIECES', 'WEIGHT_VOLUME']);
    assert.equal(table.rows.find(r => r[2] === 'offer')[5], null); assert.equal(table.rows.filter(r => r[6] !== null).reduce((n, r) => n + r[6], 0), 62);
    assert.deepEqual(buildExportTable(sanitized([row('1', 's1', { entries })], input), input).rows, table.rows);
  }
});
test('per-order entries, aggregate entries and output-row caps never silently truncate', async () => {
  const entries = Array.from({ length: 5001 }, (_, i) => ({ id: `e${i}` })); const admin = mock({ rows: [row('1', 's1', { entries })] });
  assert.equal((await run(admin, spec({ report: 'products' }))).status, 413); assert.equal(admin.writes.length, 0);
  const orders = sanitized(Array.from({ length: 11 }, (_, i) => row(String(i), 's1', { entries: entries.slice(0, 5000) })));
  assert.throws(() => buildExportTable(orders, spec({ report: 'products' })), /50 000/);
  assert.throws(() => buildExportTable(sanitized(Array.from({ length: 10001 }, (_, i) => row(String(i)))), spec()), /10 000/);
});
test('all string cells are literal and CSV neutralizes full injection prefixes; Unicode/newlines/booleans survive', () => {
  const values = ['=SUM(A1)', ' +cmd', '\t-12', '\r\n@X', '\0=cmd', '\x7f@x', 'https://example.test', 'Товар, "А"\nБ'];
  const table = { columns: ['Текст', 'Ноль', 'Пусто', 'Логика'], rows: values.map(v => [v, 0, null, false]), metadata: values.map(v => [v, v]) };
  const file = makeExportFile(table, spec({ format: 'xlsx' })), book = XLSX.read(file.bytes, { type: 'buffer' });
  assert.deepEqual(book.SheetNames, ['Report', 'Metadata']);
  for (const sheet of Object.values(book.Sheets)) for (const [key, cell] of Object.entries(sheet)) if (!key.startsWith('!')) { assert.equal(cell.f, undefined); assert.equal(cell.l, undefined); if (typeof cell.v === 'string') assert.equal(cell.t, 's'); }
  // SheetJS reads Excel CRLF as LF; values remain literal and retain the line break.
  const decoded = XLSX.utils.sheet_to_json(book.Sheets.Report, { header: 1, defval: null }); assert.deepEqual(decoded.slice(1), table.rows.map(r => r.map(v => typeof v === 'string' ? v.replaceAll('\r\n', '\n') : v))); assert.equal(book.Sheets.Report.B2.t, 'n'); assert.equal(book.Sheets.Report.D2.t, 'b');
  const csv = makeExportFile(table, spec()).bytes; assert.equal(csv.charCodeAt(0), 0xFEFF);
  for (const value of values.slice(0, 6)) assert.ok(csv.includes(csvCell(value)) && csvCell(value).startsWith('"\''));
  assert.match(csv, /Товар, ""А""\nБ/);
});
for (const report of ['orders', 'finance', 'products']) test(`${report}: deterministic CSV/XLSX row/filter/total semantic parity and no PII`, async () => {
  const rows = [row(), row('2', 's1', { totalPrice: null })], input = spec({ report });
  const table = buildExportTable(sanitized(rows, input), input), csv = makeExportFile(table, input).bytes, xlsx = makeExportFile(table, { ...input, format: 'xlsx' }).bytes;
  const csvBook = XLSX.read(Buffer.from(csv, 'utf8'), { type: 'buffer', raw: true }), xlsxBook = XLSX.read(xlsx, { type: 'buffer' });
  const csvRows = XLSX.utils.sheet_to_json(csvBook.Sheets[csvBook.SheetNames[0]], { header: 1, defval: '' });
  const expected = [table.columns, ...table.rows].map(r => r.map(v => v === null ? '' : String(v)));
  assert.deepEqual(csvRows.map(r => r.slice(0, table.columns.length)), expected);
  assert.deepEqual(XLSX.utils.sheet_to_json(xlsxBook.Sheets.Report, { header: 1, defval: null }).slice(1), table.rows);
  assert.doesNotMatch(csv + JSON.stringify(xlsxBook), /PRIVATE|recipient|waybill|api_token|deliveryAddress/);
  const actual = await run(mock({ rows }), { ...input, format: 'xlsx' }); assert.equal(actual.status, 200); assert.match(actual.headers.get('content-type'), /spreadsheetml.sheet/); assert.match(actual.headers.get('content-disposition'), /^attachment; filename="sellio-/); assert.match(actual.headers.get('cache-control'), /private, no-store/);
});
test('history owns all reads, paginates exact count, retains malformed records without raw descriptor leakage', async () => {
  const history = Array.from({ length: 25 }, (_, i) => ({ id: `h${i}`, user_id: 'u1', type: 'orders', period: i === 0 ? 'PRIVATE_LEGACY' : i === 1 ? { ...spec(), secret: 'PRIVATE_PERIOD' } : spec(), created_at: '2026-10-14T00:00:00Z' })); history.push({ id: 'foreign', user_id: 'u2', period: 'PRIVATE_OTHER' });
  const admin = mock({ history }); let total = 0, invalid = 0;
  for (const page of [1, 2]) {
    const response = await handleExport(req('history', {}, 'owner', 'GET', `?page=${page}`), 'history', admin); assert.equal(response.status, 200); const payload = await response.json(); total += payload.data.length; invalid += payload.data.filter(r => !r.regenerable).length; assert.equal(payload.meta.total, 25); assert.equal(payload.meta.totalPages, 2); assert.ok(payload.data.every(r => r.author === 'Вы')); assert.doesNotMatch(JSON.stringify(payload), /PRIVATE|user_id/);
  }
  assert.equal(total, 25); assert.equal(invalid, 2); assert.ok(admin.reads.every(r => r.conditions.some(([k, v]) => k === 'user_id' && v === 'u1')));
  for (const query of ['?page=0', '?page=1&page=2', '?user_id=u2']) assert.equal((await handleExport(req('history', {}, 'owner', 'GET', query), 'history', admin)).status, 400);
});
test('regeneration owns history ID, rechecks every saved store and uses current data', async () => {
  const history = [{ id: 'h1', user_id: 'u1', type: 'orders', period: JSON.stringify(spec({ storeIds: ['s1', 's2'] })) }], admin = mock({ history, rows: [row('new'), row('new', 's2')] });
  const foreign = await handleExport(req('regenerate', {}, 'other'), 'regenerate', admin, 'h1'); assert.equal(foreign.status, 404); assert.equal(admin.writes.length, 0);
  const regenerated = await handleExport(req('regenerate', {}), 'regenerate', admin, 'h1'); assert.equal(regenerated.status, 200); assert.match(await regenerated.text(), /O-new/); assert.equal(admin.writes.length, 1); assert.deepEqual(JSON.parse(admin.writes[0].period), spec({ storeIds: ['s1', 's2'] }));
  for (const change of ['deleted', 'transferred']) {
    const denied = mock({ history: [history[0]] }); if (change === 'deleted') denied.stores.splice(1, 1); else denied.stores[1].user_id = 'u2';
    const response = await handleExport(req('regenerate', {}), 'regenerate', denied, 'h1'); assert.equal(response.status, 404); assert.equal(denied.reads.filter(r => r.table === 'orders').length, 0); assert.equal(denied.writes.length, 0);
  }
});
test('legacy regeneration, unknown ID and extra regeneration body safely fail without new history', async () => {
  const admin = mock({ history: [{ id: 'h1', user_id: 'u1', type: 'orders', period: 'PRIVATE_LEGACY' }] });
  assert.equal((await handleExport(req('regenerate', {}), 'regenerate', admin, 'h1')).status, 422);
  assert.equal((await handleExport(req('regenerate', {}), 'regenerate', admin, 'missing')).status, 404);
  assert.equal((await handleExport(req('regenerate', { format: 'csv' }), 'regenerate', admin, 'h1')).status, 400); assert.equal(admin.writes.length, 0);
});
test('history write failure, constraint/SQL/errors and bad body fail before bytes, with no success row', async () => {
  for (const failure of ['exports', 'orders', 'stores']) { const admin = mock({ failure }); const response = await run(admin); assert.equal(response.status, 503); assert.equal(response.headers.get('content-disposition'), null); assert.equal(response.headers.get('x-sellio-history-saved'), null); assert.doesNotMatch(await response.text(), /PRIVATE|service_role|CONSTRAINT/); assert.equal(admin.writes.length, 0); }
  for (const body of ['{', JSON.stringify({ ...spec(), q: 'x'.repeat(17000) })]) { const response = await handleExport(new Request('http://localhost/api/exports', { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body }), 'create', mock()); assert.ok([400, 413].includes(response.status)); }
  assert.equal((await handleExport(req('create', spec(), 'owner', 'POST', '?user_id=u2'), 'create', mock())).status, 400);
});
test('malformed dates are excluded with explicit metadata and no raw details', async () => {
  const response = await run(mock({ rows: [row(), row('bad', 's1', { creationDate: null })] })); assert.equal(response.headers.get('x-sellio-order-count'), '1'); assert.match(await response.text(), /1 заказов без корректной даты/);
});
test('stale auth/store/period/filter identities invalidate blob and history work even without abort delivery', () => {
  const session = { user: { id: 'u1' }, access_token: 'owner' }, period = { start: spec().start, end: spec().end };
  const key = exportContextKey(session, 's1', period, { city: '' });
  for (const changed of [exportContextKey({ ...session, user: { id: 'u2' } }, 's1', period, { city: '' }), exportContextKey({ ...session, access_token: 'other' }, 's1', period, { city: '' }), exportContextKey(session, 's2', period, { city: '' }), exportContextKey(session, 's1', { ...period, end: '2026-10-13' }, { city: '' }), exportContextKey(session, 's1', period, { city: 'Астана' })]) assert.notEqual(key, changed);
  const gate = createRequestGate(), blob = gate.begin(), history = gate.begin(); assert.equal(blob.current(), false); gate.cancel(); assert.equal(history.current(), false);
  const source = readFileSync(new URL('../components/export/ExportPage.js', import.meta.url), 'utf8'); assert.match(source, /busyRef.current\) return/); assert.match(source, /if \(!current\(\)\) return/); assert.match(source, /identity.current !== context/); assert.match(source, /history.key === historyKey/); assert.match(source, /URL.revokeObjectURL/); assert.doesNotMatch(source, /from ['"].*xlsx|exportService|exportFile|style=|<button/);
});
test('approved official XLSX pin, server-only routes and honest availability remain explicit', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')); assert.equal(pkg.dependencies.xlsx, 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz'); assert.equal(XLSX.version, '0.20.3');
  for (const route of ['exports/route.js', 'exports/history/route.js', 'exports/[id]/regenerate/route.js']) { const source = readFileSync(new URL(`../app/api/${route}`, import.meta.url), 'utf8'); assert.match(source, /runtime = 'nodejs'/); assert.match(source, /handleExport/); }
  const source = readFileSync(new URL('../components/landing/model.js', import.meta.url), 'utf8'); assert.match(source, /Excel \(\.xlsx\)/); assert.match(source, /Email, PDF и Google Sheets не реализованы/);
});
