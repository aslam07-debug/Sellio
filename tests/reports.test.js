import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReportQuery, midnight, sanitizeOrder, filterOrders, buildReports, ordersCsv, csvCell } from '../lib/reportData.js';
import { handleReport, readImportedOrders } from '../lib/reportService.js';
import { createRequestGate, dateKey, defaultPeriod, deliveryLabel, paymentLabel } from '../lib/reportView.js';
import { normalizeOrders } from '../lib/kaspi.js';

const url = 'http://localhost/api?storeId=s1&start=2026-06-01&end=2026-06-14';
const query = parseReportQuery(url);
const row = (id = '1', changes = {}) => ({ id, store_id: 's1', order_code: `O-${id}`, status: 'COMPLETED', updated_at: '2026-06-03T00:00:00.000Z', comment: '', data: { kaspi: { creationDate: midnight('2026-06-03'), totalPrice: 100, city: 'Алматы', entriesComplete: true, entries: [{ id: 'e1', productId: 'master-1', orderedQuantity: 2, totalPrice: 100, unitType: 'PIECES' }], ...changes } } });
const request = (suffix = '', method = 'GET', input, auth = 'Bearer owner') => new Request(url + suffix, { method, headers: { ...(auth ? { Authorization: auth } : {}), ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(input !== undefined ? { body: JSON.stringify(input) } : {}) });
function mockAdmin(rows = [], { conflict = false, error = false } = {}) {
  const writes = [], reads = [];
  return { writes, reads, auth: { getUser: async token => ({ data: { user: token === 'owner' ? { id: 'u1' } : token === 'other' ? { id: 'u2' } : null } }) }, from(table) {
    let conditions = [], range = null, limit = null, update;
    const builder = {
      select() { return this; }, eq(key, value) { conditions.push([key, value]); return this; }, order() { return this; },
      range(a, b) { range = [a, b]; return this; }, limit(n) { limit = n; return this; }, update(fields) { update = fields; return this; },
      async maybeSingle() { const result = await this; return { ...result, data: result.data?.[0] ?? null }; },
      then(resolve, reject) {
        reads.push({ table, conditions });
        const source = table === 'stores' ? [{ id: 's1', name: 'Мой магазин', user_id: 'u1', marketplace: 'kaspi', api_token_encrypted: 'PRIVATE' }] : rows;
        let data = source.filter(r => conditions.every(([key, v]) => r[key] === v));
        if (update) { if (conflict) data = []; else { for (const r of data) Object.assign(r, update); writes.push(update); } }
        data = data.slice().sort((a, b) => a.id.localeCompare(b.id));
        if (range) data = data.slice(range[0], range[1] + 1); if (limit) data = data.slice(0, limit);
        return Promise.resolve({ data, error: error ? { message: 'PRIVATE SQL DETAIL' } : null }).then(resolve, reject);
      }
    }; return builder;
  } };
}

test('strict calendar, range, filter and pagination validation before queries', () => {
  for (const suffix of ['&start=2026-06-02', '&userId=u1', '&status=COMPLETED', '&page=0', '&pageSize=101', '&format=xlsx', '&city=' + 'x'.repeat(201)]) assert.throws(() => parseReportQuery(url + suffix, { orders: true }));
  assert.throws(() => parseReportQuery(url + '&q=x'));
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-01-00', '1800-01-01']) assert.throws(() => midnight(value));
  assert.doesNotThrow(() => midnight('2024-02-29'));
  assert.throws(() => parseReportQuery(url.replace('2026-06-14', '2026-07-02')));
  assert.throws(() => parseReportQuery(url.replace('2026-06-14', '2026-05-31')));
  assert.throws(() => parseReportQuery(url + '&q=' + 'x'.repeat(101), { orders: true }));
});
test('Almaty calendar midnight, end-exclusive boundaries and historical offset', () => {
  assert.equal(midnight('2026-06-01'), Date.parse('2026-05-31T19:00:00Z'));
  assert.equal(midnight('2023-06-01'), Date.parse('2023-05-31T18:00:00Z'));
  const orders = filterOrders([row('1', { creationDate: query.from - 1 }), row('2', { creationDate: query.from }), row('3', { creationDate: query.to - 1 }), row('4', { creationDate: query.to })], query);
  assert.deepEqual(orders.map(o => o.id), ['3', '2']);
  assert.equal(dateKey(query.from), '2026-06-01');
  assert.deepEqual(defaultPeriod(query.from), { start: '2026-05-19', end: '2026-06-01' });
});
test('sanitized DTO omits raw customer, address, documents, tokens and nested extras', () => {
  const input = row(); input.data.kaspi.customer = { name: 'PRIVATE_NAME', cellPhone: 'PRIVATE_PHONE' };
  input.data.kaspi.deliveryAddress = { town: 'Алматы', street: 'PRIVATE_STREET' };
  input.data.kaspi.recipient = { phoneAlias: 'PRIVATE_ALIAS' }; input.data.kaspi.included = [{ attributes: { customer: 'PRIVATE_INCLUDED' } }];
  input.data.kaspi.entries[0].unknown = 'PRIVATE_ENTRY'; input.data.kaspi.waybill = 'PRIVATE_URL'; input.api_token_encrypted = 'PRIVATE_TOKEN';
  const result = sanitizeOrder(input);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|customer|recipient|deliveryAddress|api_token/);
  assert.doesNotMatch(ordersCsv([result]), /PRIVATE/);
  assert.equal(result.city, 'Алматы');
});
test('missing/malformed money is null; valid zero survives; unknown statuses remain counted', () => {
  for (const totalPrice of [null, undefined, '100', -1, NaN, Infinity]) assert.equal(sanitizeOrder(row('1', { totalPrice })).totalPrice, null);
  assert.equal(sanitizeOrder(row('1', { totalPrice: 0 })).totalPrice, 0);
  const input = [row('1'), row('2'), row('3')]; input[0].status = 'CANCELLING'; input[1].status = 'RETURN_REQUESTED'; input[2].status = 'FUTURE_STATUS';
  const report = buildReports(filterOrders(input, query), query);
  assert.equal(report.summary.count.pending, 2); assert.equal(report.summary.count.unknown, 1); assert.equal(report.summary.count.returned, 0);
  assert.equal(Object.values(report.summary.count).reduce((a, b) => a + b), 3);
});
test('completed-only monetary scope, priced AOV and unavailable commission/profit', () => {
  const input = [row('1', { totalPrice: 0 }), row('2', { totalPrice: null }), row('3', { totalPrice: 200 }), row('4', { totalPrice: 999 })]; input[3].status = 'CANCELLED';
  const reports = buildReports(filterOrders(input, query), query), f = reports.summary.financial;
  assert.equal(f.value, null); assert.equal(f.knownSum, 200); assert.equal(f.missing, 1); assert.equal(f.priced, 2); assert.equal(f.average, 100);
  assert.equal(f.commission, null); assert.equal(f.profit, null); assert.equal(reports.revenue[2].amount, null); assert.equal(reports.revenue[2].orders, 4);
  assert.ok(reports.summary.warnings.length);
});
test('zero orders is a valid zero count and completed sum, no invented AOV', () => {
  const reports = buildReports([], query); assert.equal(reports.summary.total, 0); assert.equal(reports.summary.financial.value, 0); assert.equal(reports.summary.financial.average, null); assert.equal(reports.revenue.length, 14);
});
test('express metrics use observed order denominator and delivery fee is not commission', () => {
  const input = [row('1', { deliveryCostForSeller: 0 }), row('2', { deliveryCostForSeller: null })]; input[0].status = 'CANCELLED'; input[1].comment = 'Заметка';
  const summary = buildReports(filterOrders(input, query), query).summary;
  assert.equal(summary.quickMetrics.cancelledPercent, 50); assert.equal(summary.quickMetrics.commentPercent, 50); assert.equal(summary.quickMetrics.returnedPercent, 0);
  assert.equal(summary.quickMetrics.sellerDelivery.value, null); assert.equal(summary.quickMetrics.sellerDelivery.missing, 1); assert.equal(summary.financial.commission, null);
  assert.equal(buildReports([], query).summary.quickMetrics.commentPercent, null);
});
test('city unknown bucket uses the same all-order denominator', () => {
  const reports = buildReports(filterOrders([row('1'), row('2', { city: null })], query), query);
  assert.deepEqual(reports.cities.map(c => c.percent), [50, 50]); assert.ok(reports.cities.some(c => c.label === 'Неизвестный город'));
});
test('product aggregation preserves offer/catalog kind and units, never assigns order amount', () => {
  const input = row('1', { totalPrice: 9999, entries: [
    { id: 'a', productId: 'catalog', orderedQuantity: 2, unitType: 'PIECES', totalPrice: 20 },
    { id: 'b', productId: 'catalog', orderedQuantity: 0.5, unitType: 'WEIGHT_VOLUME', totalPrice: 30 },
    { id: 'c', offerCode: 'offer', name: 'Товар', orderedQuantity: null, unitType: null, totalPrice: null }
  ] });
  const products = buildReports(filterOrders([input], query), query).products;
  assert.equal(products.length, 3); assert.equal(products[0].unit, 'WEIGHT_VOLUME'); assert.equal(products[0].quantity, 0.5);
  assert.equal(products[1].codeKind, 'catalog'); assert.equal(products[2].codeKind, 'offer'); assert.equal(products[2].quantity, null);
  assert.equal(products.slice(0, 2).reduce((s, p) => s + p.value, 0), 50); assert.doesNotMatch(JSON.stringify(products), /sellerSKU/);
});
test('delivery missing boolean is unknown; PREPAID is cashless, not Gold', () => {
  assert.match(deliveryLabel({ deliveryMode: 'DELIVERY_PICKUP' }), /неизвестен/);
  assert.equal(deliveryLabel({ deliveryMode: 'DELIVERY_PICKUP', isKaspiDelivery: false }), 'Самовывоз');
  assert.equal(deliveryLabel({ deliveryMode: 'DELIVERY_PICKUP', isKaspiDelivery: true }), 'Постомат');
  assert.equal(paymentLabel('PREPAID'), 'Безналичная оплата');
});
test('normalization reads town string and linked entries, omits private fields', () => {
  const order = { id: 'opaque', attributes: { code: 'human', status: 'COMPLETED', creationDate: query.from, totalPrice: 0, customer: { name: 'PRIVATE' }, deliveryAddress: { town: 'Алматы', street: 'PRIVATE' }, originAddress: { city: { name: 'Wrong seller city' } }, deliveryMode: 'DELIVERY_PICKUP', paymentMode: 'PREPAID' }, relationships: { entries: { data: [{ id: 'right' }] } } };
  const collection = { data: [order], included: [{ type: 'orderentries', id: 'wrong', attributes: { quantity: 100 } }, { type: 'orderentries', id: 'right', attributes: { quantity: 0.5, unitType: 'WEIGHT_VOLUME', offer: { code: 'offer1', name: 'Товар' }, totalPrice: 0 } }] };
  const result = normalizeOrders(collection, { start: query.from, end: query.to, runId: 'r' })[0];
  assert.equal(result.kaspi.city, 'Алматы'); assert.equal(result.kaspi.entries[0].orderedQuantity, 0.5); assert.equal(result.kaspi.isKaspiDelivery, null); assert.equal(result.kaspi.entries[0].offerCode, 'offer1');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|Wrong seller city/);
});
test('CSV BOM, quotes, unicode and formula neutralization including leading control', () => {
  for (const s of ['=SUM(A1)', ' +cmd', '\t-12', '\r\n@X', '\u0000=cmd']) assert.ok(csvCell(s).startsWith('"\''));
  assert.equal(csvCell('Товар, "А"\nБ'), '"Товар, ""А""\nБ"');
  const csv = ordersCsv([sanitizeOrder({ ...row(), comment: '\t=HYPERLINK("x")' })]); assert.equal(csv.charCodeAt(0), 0xFEFF); assert.match(csv, /Алматы/); assert.match(csv, /'\t=HYPERLINK/);
});
test('request identity blocks late cross-store responses and cancellation', () => {
  const gate = createRequestGate(), first = gate.begin(), next = gate.begin();
  assert.equal(first.signal.aborted, true); assert.equal(first.current(), false); assert.equal(next.current(), true); gate.cancel(); assert.equal(next.current(), false);
});
for (const kind of ['summary', 'cities', 'products', 'revenue', 'orders', 'stores']) {
  test(`${kind}: authentication and cross-owner denial, safe private errors`, async () => {
    const admin = mockAdmin([row()]);
    const unsigned = await handleReport(request('', 'GET', undefined, ''), kind, admin); assert.equal(unsigned.status, 401); assert.match(unsigned.headers.get('cache-control'), /no-store/);
    const config = await handleReport(request(), kind, null); assert.equal(config.status, 503);
    const other = await handleReport(request('', 'GET', undefined, 'Bearer other'), kind, admin);
    assert.equal(other.status, kind === 'stores' ? 200 : 404); assert.doesNotMatch(await other.text(), /PRIVATE|Мой магазин|O-1/);
    assert.equal(admin.writes.length, 0);
  });
}
test('read >1000 all pages; filters/search and export apply across full set', async () => {
  const rows = Array.from({ length: 1205 }, (_, i) => row(String(i).padStart(5, '0'), { city: i > 1000 ? 'Астана' : 'Алматы', entries: [{ id: `e${i}`, name: i > 1000 ? 'Последний товар' : 'Первый товар', orderedQuantity: 1 }] }));
  const admin = mockAdmin(rows); assert.equal((await readImportedOrders(admin, 's1')).length, 1205);
  const response = await handleReport(request('&city=Астана&q=Последний&status=completed&page=2&pageSize=100'), 'orders', admin);
  const payload = await response.json(); assert.equal(payload.meta.total, 204); assert.equal(payload.meta.totalPages, 3); assert.equal(payload.data.length, 100);
  const csv = await handleReport(request('&city=Астана&q=Последний&status=completed&format=csv'), 'orders', admin);
  assert.equal((await csv.text()).split('\r\n').length, 205);
  const summary = await (await handleReport(request(), 'summary', admin)).json(); assert.equal(summary.data.total, 1205);
});
test('cap fails explicitly at 10001, never a partial complete report', async () => {
  const admin = mockAdmin(Array.from({ length: 10001 }, (_, i) => row(String(i).padStart(5, '0'))));
  const result = await handleReport(request(), 'orders', admin); assert.equal(result.status, 409); assert.match((await result.json()).error, /10 000/);
});
test('dedup, deterministic ties and honest out-of-range page', async () => {
  const rows = [row('b'), row('a'), { ...row('c'), order_code: 'O-a' }];
  assert.deepEqual(filterOrders(rows, query).map(o => o.id), ['a', 'b']);
  const result = await (await handleReport(request('&page=99'), 'orders', mockAdmin(rows))).json(); assert.equal(result.data.length, 0); assert.equal(result.meta.total, 2); assert.equal(result.meta.page, 99);
});
test('comment protected ownership, other-store order, not-found and conflict', async () => {
  const input = { id: '1', comment: 'Мой комментарий', expectedUpdatedAt: row().updated_at };
  assert.equal((await handleReport(request('', 'PATCH', input, 'Bearer other'), 'orders', mockAdmin([row()]))).status, 404);
  assert.equal((await handleReport(request('', 'PATCH', input), 'orders', mockAdmin([{ ...row(), store_id: 'other' }]))).status, 404);
  assert.equal((await handleReport(request('', 'PATCH', input), 'orders', mockAdmin([]))).status, 404);
  assert.equal((await handleReport(request('', 'PATCH', { ...input, expectedUpdatedAt: '2026-06-04T00:00:00Z' }), 'orders', mockAdmin([row()]))).status, 409);
  assert.equal((await handleReport(request('', 'PATCH', input), 'orders', mockAdmin([row()], { conflict: true }))).status, 409);
});
test('comment CAS save preserves status and data; rejects invalid or excessive fields', async () => {
  const original = row(), admin = mockAdmin([original]);
  const input = { id: '1', comment: '<script>text only</script>', expectedUpdatedAt: original.updated_at };
  const response = await handleReport(request('', 'PATCH', input), 'orders', admin); assert.equal(response.status, 200); assert.equal(original.status, 'COMPLETED'); assert.equal(original.data.kaspi.totalPrice, 100); assert.equal(original.comment, input.comment);
  assert.deepEqual(Object.keys(admin.writes[0]).sort(), ['comment', 'updated_at']);
  for (const bad of [{ ...input, comment: 'x'.repeat(2001) }, { ...input, status: 'COMPLETED' }, { ...input, comment: 0 }, { ...input, expectedUpdatedAt: null }]) assert.equal((await handleReport(request('', 'PATCH', bad), 'orders', mockAdmin([row()]))).status, 400);
});
for (const clockOffset of [0, -60000]) {
  test(`comment CAS advances with clock offset ${clockOffset} and rejects stale editor`, async t => {
    const original = row(), previous = original.updated_at, admin = mockAdmin([original]);
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(previous) + clockOffset });
    const input = { id: original.id, comment: 'First editor', expectedUpdatedAt: previous };
    const first = await handleReport(request('', 'PATCH', input), 'orders', admin);
    assert.equal(first.status, 200);
    const saved = await first.json();
    assert.equal(Date.parse(saved.data.updatedAt), Date.parse(previous) + 1);
    assert.equal(original.updated_at, saved.data.updatedAt);
    const stale = await handleReport(request('', 'PATCH', { ...input, comment: 'Stale editor' }), 'orders', admin);
    assert.equal(stale.status, 409);
    assert.equal(original.comment, 'First editor');
    assert.equal(original.updated_at, saved.data.updatedAt);
    assert.equal(admin.writes.length, 1);
  });
}
test('comment CAS retains the raw microsecond timestamp in the conditional filter', async t => {
  const original = { ...row(), updated_at: '2026-06-03T00:00:00.000987+00:00' };
  const previous = original.updated_at, admin = mockAdmin([original]);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(previous) });
  const response = await handleReport(request('', 'PATCH', { id: original.id, comment: 'Saved', expectedUpdatedAt: previous }), 'orders', admin);
  assert.equal(response.status, 200);
  assert.equal(original.updated_at, '2026-06-03T00:00:00.001Z');
  assert.ok(admin.reads.some(r => r.table === 'orders' && r.conditions.some(([key, value]) => key === 'updated_at' && value === previous)));
});
test('comment CAS refuses unknown/invalid versions and unrepresentable successor safely', async () => {
  const validInput = { id: '1', comment: 'Must not overwrite', expectedUpdatedAt: row().updated_at };
  for (const version of [null, undefined, 'invalid-private-timestamp']) {
    const original = { ...row(), updated_at: version, comment: 'Keep original' }, admin = mockAdmin([original]);
    const response = await handleReport(request('', 'PATCH', validInput), 'orders', admin);
    assert.equal(response.status, 409); assert.equal(admin.writes.length, 0); assert.equal(original.comment, 'Keep original');
    assert.doesNotMatch(await response.text(), /invalid-private-timestamp|RangeError|Invalid time/);
  }
  for (const expectedUpdatedAt of [null, 'invalid-private-timestamp']) {
    const admin = mockAdmin([{ ...row(), updated_at: expectedUpdatedAt }]);
    const response = await handleReport(request('', 'PATCH', { ...validInput, expectedUpdatedAt }), 'orders', admin);
    assert.equal(response.status, 400); assert.equal(admin.writes.length, 0);
  }
  const maximum = '+275760-09-13T00:00:00.000Z';
  const original = { ...row(), updated_at: maximum, comment: 'Keep original' }, admin = mockAdmin([original]);
  const response = await handleReport(request('', 'PATCH', { ...validInput, expectedUpdatedAt: maximum }), 'orders', admin);
  assert.equal(response.status, 503); assert.equal(admin.writes.length, 0); assert.equal(original.comment, 'Keep original');
  assert.doesNotMatch(await response.text(), /RangeError|Invalid time|275760/);
});
test('export cross-owner guard and no query validation database read leakage', async () => {
  const admin = mockAdmin([row()]); assert.equal((await handleReport(request('&format=csv', 'GET', undefined, 'Bearer other'), 'orders', admin)).status, 404);
  const invalid = await handleReport(request('&page=0'), 'orders', admin); assert.equal(invalid.status, 400); assert.equal(admin.reads.filter(r => r.table === 'orders').length, 0);
  const failure = await handleReport(request(), 'summary', mockAdmin([row()], { error: true })); assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /PRIVATE SQL/);
});
test('malformed date rows are excluded with explicit availability warning', async () => {
  const admin = mockAdmin([row('1', { creationDate: null }), row('2')]);
  const summary = await (await handleReport(request(), 'summary', admin)).json();
  assert.equal(summary.data.total, 1); assert.match(summary.data.warnings.join(' '), /дата создания/);
  const orders = await (await handleReport(request(), 'orders', admin)).json(); assert.equal(orders.meta.warnings.length, 1);
});
