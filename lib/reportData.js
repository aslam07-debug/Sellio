import { dateKey, shiftDay, statuses, orderDate, deliveryLabel, paymentLabel } from './reportView.js';

export class ReportError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = message => { throw new ReportError(message); };
const text = (value, max = 512) => typeof value === 'string' && value.length <= max ? value : null;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const midnight = key => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return fail('Дата должна иметь формат YYYY-MM-DD.');
  const base = Date.parse(`${key}T00:00:00Z`);
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 10) !== key || Number(key.slice(0, 4)) < 2020 || Number(key.slice(0, 4)) > 2100) return fail('Некорректная календарная дата (2020–2100).');
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = base;
  for (let i = 0; i < 3; i += 1) {
    const p = Object.fromEntries(fmt.formatToParts(instant).map(part => [part.type, part.value]));
    instant += base - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  }
  return instant;
};
export const parseReportQuery = (url, { orders = false } = {}) => {
  const p = new URL(url).searchParams;
  const allowed = ['storeId', 'start', 'end', ...(orders ? ['q', 'status', 'city', 'page', 'pageSize', 'format'] : [])];
  for (const [key] of p) if (!allowed.includes(key) || p.getAll(key).length !== 1) fail('Неизвестный или повторяющийся параметр.');
  const storeId = p.get('storeId');
  if (!storeId || storeId.length > 200 || /[\x00-\x20\x7f]/.test(storeId)) fail('Выберите магазин.');
  const start = p.get('start') ?? '', end = p.get('end') ?? '';
  const from = midnight(start); midnight(end);
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
  if (days < 1 || days > 31) fail('Выберите период от 1 до 31 календарного дня.');
  const integer = (key, fallback, max) => {
    const value = p.get(key) ?? String(fallback);
    if (!/^[1-9]\d{0,5}$/.test(value) || Number(value) > max) fail('Некорректная пагинация.');
    return Number(value);
  };
  const status = p.get('status') ?? '', city = p.get('city') ?? '', q = p.get('q') ?? '', format = p.get('format') ?? 'json';
  if (status && !Object.hasOwn(statuses, status)) fail('Некорректный статус.');
  if (q.length > 100 || city.length > 200 || /[\x00-\x1f\x7f]/.test(q + city)) fail('Слишком длинный или некорректный фильтр.');
  if (!['json', 'csv'].includes(format)) fail('Поддерживаются JSON и CSV.');
  return { storeId, start, end, from, to: midnight(shiftDay(end, 1)), days, status, city, q, format, page: integer('page', 1, 10000), pageSize: integer('pageSize', 20, 100) };
};
export const sanitizeOrder = row => {
  const k = row.data?.kaspi ?? {};
  const status = text(row.status, 100) ?? text(k.status, 100);
  const bucket = ({ COMPLETED: 'completed', CANCELLED: 'cancelled', RETURNED: 'returned', CANCELLING: 'pending', RETURN_REQUESTED: 'pending', APPROVED_BY_BANK: 'pending', ACCEPTED_BY_MERCHANT: 'pending', ASSEMBLE: 'pending' })[status] ?? 'unknown';
  const creationDate = Number.isSafeInteger(k.creationDate) && k.creationDate >= Date.parse('2019-12-31T18:00:00Z') && k.creationDate < Date.parse('2100-12-31T19:00:00Z') ? k.creationDate : null;
  return {
    id: String(row.id), code: text(row.order_code) ?? text(k.code) ?? 'Без номера', state: text(k.state, 100), status, bucket,
    creationDate, city: text(k.city, 200) || 'Неизвестный город', totalPrice: amount(k.totalPrice),
    deliveryMode: text(k.deliveryMode, 100), isKaspiDelivery: typeof k.isKaspiDelivery === 'boolean' ? k.isKaspiDelivery : null,
    deliveryCostForSeller: amount(k.deliveryCostForSeller), deliveryCost: amount(k.deliveryCost), paymentMode: text(k.paymentMode, 100), creditTerm: amount(k.creditTerm),
    entriesComplete: k.entriesComplete === true,
    entries: (Array.isArray(k.entries) ? k.entries.slice(0, 5000) : []).map(e => ({
      id: text(e.id), name: text(e.name), code: text(e.offerCode), codeKind: text(e.offerCode) ? 'offer' : null,
      catalogId: text(e.productId), quantity: amount(e.orderedQuantity), unit: ['PIECES', 'WEIGHT_VOLUME'].includes(e.unitType) ? e.unitType : null,
      totalPrice: amount(e.totalPrice), basePrice: amount(e.basePrice)
    })),
    comment: text(row.comment, 2000) ?? '', updatedAt: text(row.updated_at, 100)
  };
};
export const filterOrders = (rows, query) => {
  const unique = new Map();
  for (const row of rows) {
    const o = sanitizeOrder(row);
    if (o.creationDate === null || o.creationDate < query.from || o.creationDate >= query.to) continue;
    if (query.status && o.bucket !== query.status || query.city && o.city !== query.city) continue;
    const haystack = [o.code, ...o.entries.flatMap(e => [e.name, e.code, e.catalogId])].filter(Boolean).join(' ').toLocaleLowerCase('ru');
    if (query.q && !haystack.includes(query.q.toLocaleLowerCase('ru'))) continue;
    if (!unique.has(o.code)) unique.set(o.code, o);
  }
  return [...unique.values()].sort((a, b) => b.creationDate - a.creationDate || a.id.localeCompare(b.id));
};
const sumKnown = values => { const known = values.filter(v => v !== null); return { value: known.length === values.length ? known.reduce((a, b) => a + b, 0) : null, knownSum: known.reduce((a, b) => a + b, 0), missing: values.length - known.length, priced: known.length }; };
export const buildReports = (orders, query) => {
  const count = Object.fromEntries(Object.keys(statuses).map(key => [key, 0]));
  const days = Array.from({ length: query.days }, (_, i) => ({ day: shiftDay(query.start, i), orders: 0, completed: [], amount: 0, missing: 0 }));
  const cities = new Map(), products = new Map(), deliveries = new Map(), payments = new Map(), hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 }));
  for (const o of orders) {
    count[o.bucket] += 1;
    const day = days.find(d => d.day === dateKey(o.creationDate));
    if (day) { day.orders += 1; if (o.bucket === 'completed') day.completed.push(o.totalPrice); }
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', hourCycle: 'h23' }).format(o.creationDate));
    hours[hour].orders += 1;
    cities.set(o.city, (cities.get(o.city) ?? 0) + 1);
    for (const [map, label] of [[deliveries, deliveryLabel(o)], [payments, paymentLabel(o.paymentMode)]]) map.set(label, (map.get(label) ?? 0) + 1);
    for (const e of o.entries) {
      const identity = e.code ? `offer:${e.code}` : e.catalogId ? `catalog:${e.catalogId}` : `entry:${e.id}`;
      const key = `${identity}:${e.unit ?? 'unknown'}`;
      const product = products.get(key) ?? { key, name: e.name ?? 'Название не получено', code: e.code ?? e.catalogId ?? e.id, codeKind: e.codeKind ?? (e.catalogId ? 'catalog' : 'entry'), unit: e.unit, quantities: [], values: [] };
      product.quantities.push(e.quantity); product.values.push(e.totalPrice); products.set(key, product);
    }
  }
  const completed = orders.filter(o => o.bucket === 'completed');
  const financial = sumKnown(completed.map(o => o.totalPrice));
  const list = map => [...map].map(([label, value]) => ({ label, value, percent: orders.length ? value / orders.length * 100 : 0 })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return {
    summary: { total: orders.length, count, financial: { ...financial, average: financial.priced ? financial.knownSum / financial.priced : null, commission: null, profit: null },
      quickMetrics: { cancelledPercent: orders.length ? count.cancelled / orders.length * 100 : null, returnedPercent: orders.length ? count.returned / orders.length * 100 : null,
        commentPercent: orders.length ? orders.filter(o => o.comment.trim()).length / orders.length * 100 : null, sellerDelivery: sumKnown(orders.map(o => o.deliveryCostForSeller)) },
      coverage: 'По импортированным заказам; импорт ограничен последними 14 днями. Не полная история и не расчёты Kaspi.',
      warnings: [financial.missing ? `Нет суммы у ${financial.missing} завершённых заказов. Средний чек рассчитан только по ${financial.priced} заказам с суммой.` : null,
        orders.some(o => !o.entriesComplete) ? 'Часть позиций заказов не получена.' : null,
        orders.some(o => o.city === 'Неизвестный город') ? 'Часть городов не получена; нужен повторный импорт.' : null].filter(Boolean), deliveries: list(deliveries), payments: list(payments), hours, recent: orders.slice(0, 6) },
    cities: list(cities), revenue: days.map(({ completed: values, ...d }) => ({ ...d, amount: sumKnown(values).value, missing: sumKnown(values).missing })),
    products: [...products.values()].map(({ quantities, values, ...p }) => ({ ...p, quantity: sumKnown(quantities).value, value: sumKnown(values).value }))
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.key.localeCompare(b.key)).slice(0, 10)
  };
};
export const csvCell = value => {
  let s = value === null || value === undefined ? 'Нет данных' : String(value);
  if (/^[\s\x00-\x1f\x7f]*[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
};
export const ordersCsv = orders => '\uFEFF' + [
  ['Номер', 'Дата Asia/Almaty', 'Город', 'Товары / код предложения или каталога', 'Количество / единица', 'Сумма KZT', 'Доставка', 'Оплата', 'Статус', 'Комментарий'],
  ...orders.map(o => [o.code, orderDate(o.creationDate), o.city, o.entries.map(e => `${e.name ?? 'Нет названия'} (${e.code ?? e.catalogId ?? 'Нет кода'}; ${e.codeKind ?? 'catalog'})`).join('; '), o.entries.map(e => `${e.quantity ?? 'Нет данных'} ${e.unit ?? 'Единица неизвестна'}`).join('; '), o.totalPrice, deliveryLabel(o), paymentLabel(o.paymentMode), statuses[o.bucket], o.comment])
].map(row => row.map(csvCell).join(',')).join('\r\n');
