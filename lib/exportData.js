import { ReportError, parseReportQuery } from './reportData.js';
import { dateKey, shiftDay, orderDate, statuses, deliveryLabel, paymentLabel } from './reportView.js';

export const EXPORT_MAX_STORES = 10;
export const EXPORT_MAX_RECORDS = 10000;
export const EXPORT_MAX_ENTRIES = 50000;
export const validExportId = v => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\s\x00-\x1f\x7f]/.test(v);
const fail = message => { throw new ReportError(message); };
export const validateExport = input => {
  const allowed = ['version', 'report', 'format', 'storeIds', 'start', 'end', 'status', 'city', 'q', 'group', 'sort'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) fail('Недопустимые поля экспорта.');
  if (input.version !== 1 || !['orders', 'finance', 'products'].includes(input.report) || !['csv', 'xlsx'].includes(input.format)) fail('Нужны версия 1, тип отчёта и формат CSV или XLSX.');
  if (!Array.isArray(input.storeIds) || !input.storeIds.length || input.storeIds.length > EXPORT_MAX_STORES || input.storeIds.some(v => !validExportId(v)) || new Set(input.storeIds).size !== input.storeIds.length) fail('Выберите от 1 до 10 разных магазинов Kaspi.');
  for (const key of ['start', 'end', 'status', 'city', 'q', 'group', 'sort']) if (input[key] !== undefined && typeof input[key] !== 'string') fail('Некорректный тип фильтра.');
  if (typeof input.start !== 'string' || typeof input.end !== 'string' || input.start.length !== 10 || input.end.length !== 10) fail('Выберите календарные даты.');
  const params = new URLSearchParams({ storeId: input.storeIds[0], start: input.start, end: input.end, status: input.status ?? '', city: input.city ?? '', q: input.q ?? '' });
  const query = parseReportQuery(`http://localhost/?${params}`, { orders: true });
  const group = input.group ?? 'day', sort = input.sort ?? 'amount';
  if (!['day', 'week', 'month'].includes(group) || !['quantity', 'amount', 'name'].includes(sort)) fail('Недопустимая группировка или сортировка.');
  return { version: 1, report: input.report, format: input.format, storeIds: [...input.storeIds].sort(), start: query.start, end: query.end, status: query.status, city: query.city, q: query.q, group, sort };
};
export const descriptorQuery = descriptor => parseReportQuery(`http://localhost/?${new URLSearchParams({ storeId: descriptor.storeIds[0], start: descriptor.start, end: descriptor.end, status: descriptor.status, city: descriptor.city, q: descriptor.q })}`, { orders: true });
export const parseExportPeriod = (period, type) => {
  try {
    const input = typeof period === 'string' && period.length <= 16384 ? JSON.parse(period) : period;
    const descriptor = validateExport(input);
    return descriptor.report === type ? descriptor : null;
  } catch { return null; }
};
export const exportGroupKey = (instant, group) => {
  const day = dateKey(instant);
  if (group === 'month') return day.slice(0, 7);
  if (group === 'week') { const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); return shiftDay(day, -((weekday + 6) % 7)); }
  return day;
};
const sum = values => {
  const known = values.filter(v => v !== null), knownSum = known.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(knownSum)) throw new ReportError('Суммы превышают безопасный числовой диапазон.', 422);
  return { value: known.length === values.length ? knownSum : null, knownSum, missing: values.length - known.length, priced: known.length };
};
export const buildExportTable = (orders, descriptor, warnings = []) => {
  let columns, rows;
  if (descriptor.report === 'orders') {
    columns = ['Магазин', 'Номер', 'Дата Asia/Almaty', 'Город', 'Статус', 'Сумма KZT', 'Доставка продавца KZT', 'Доставка', 'Оплата', 'Позиции получены полностью'];
    rows = orders.map(o => [o.storeName, o.code, orderDate(o.creationDate), o.city, statuses[o.bucket], o.totalPrice, o.deliveryCostForSeller, deliveryLabel(o), paymentLabel(o.paymentMode), o.entriesComplete]);
  } else if (descriptor.report === 'finance') {
    columns = ['Магазин', 'Период группы Asia/Almaty', 'Завершённых заказов', 'Сумма завершённых KZT', 'Известная сумма KZT', 'Без суммы', 'Средний чек известных KZT', 'Доставка продавца завершённых KZT', 'Без стоимости доставки', 'Комиссия KZT', 'Чистая прибыль KZT'];
    const groups = new Map();
    for (const o of orders.filter(o => o.bucket === 'completed')) {
      const day = exportGroupKey(o.creationDate, descriptor.group), key = JSON.stringify([o.storeId, day]);
      const g = groups.get(key) ?? { store: o.storeName, storeId: o.storeId, day, prices: [], deliveries: [] };
      g.prices.push(o.totalPrice); g.deliveries.push(o.deliveryCostForSeller); groups.set(key, g);
    }
    rows = [...groups.values()].sort((a, b) => a.day.localeCompare(b.day) || a.storeId.localeCompare(b.storeId)).map(g => {
      const money = sum(g.prices), delivery = sum(g.deliveries);
      return [g.store, g.day, g.prices.length, money.value, money.knownSum, money.missing, money.priced ? money.knownSum / money.priced : null, delivery.value, delivery.missing, null, null];
    });
  } else {
    columns = ['Магазин', 'Товар', 'Наблюдаемый код (не подтверждённый SKU)', 'Тип кода', 'Единица', 'Количество', 'Сумма позиций KZT', 'Без количества', 'Без суммы'];
    const products = new Map(); let entries = 0;
    for (const o of orders) for (let i = 0; i < o.entries.length; i += 1) {
      if (++entries > EXPORT_MAX_ENTRIES) throw new ReportError('Более 50 000 позиций: сократите период или набор магазинов. Частичный экспорт не сформирован.', 413);
      const e = o.entries[i], kind = e.code ? 'offer' : e.catalogId ? 'catalog' : 'entry';
      // Unidentified entries stay separate; neither catalog IDs nor offers claim seller SKU linkage.
      const code = e.code ?? e.catalogId ?? e.id ?? `${o.id}:${i}`;
      const key = JSON.stringify([o.storeId, kind, code, e.unit]);
      const p = products.get(key) ?? { key, store: o.storeName, name: e.name ?? 'Название не получено', code, kind, unit: e.unit, quantities: [], prices: [] };
      if (e.name && e.name.localeCompare(p.name, 'ru') < 0) p.name = e.name;
      p.quantities.push(e.quantity); p.prices.push(e.totalPrice); products.set(key, p);
    }
    const list = [...products.values()].map(p => ({ ...p, quantity: sum(p.quantities), money: sum(p.prices) }));
    list.sort((a, b) => (descriptor.sort === 'name' ? a.name.localeCompare(b.name, 'ru') : ((descriptor.sort === 'quantity' ? b.quantity.value : b.money.value) ?? -1) - ((descriptor.sort === 'quantity' ? a.quantity.value : a.money.value) ?? -1)) || a.key.localeCompare(b.key));
    rows = list.map(p => [p.store, p.name, p.code, p.kind, p.unit, p.quantity.value, p.money.value, p.quantity.missing, p.money.missing]);
  }
  if (rows.length > EXPORT_MAX_RECORDS) throw new ReportError('Более 10 000 строк результата: сократите фильтры. Частичный экспорт не сформирован.', 413);
  const completed = orders.filter(o => o.bucket === 'completed'), total = sum(completed.map(o => o.totalPrice));
  const metadata = [
    ['Версия', 1], ['Отчёт', descriptor.report], ['Формат', descriptor.format], ['Начало', descriptor.start], ['Конец включительно', descriptor.end], ['Часовой пояс', 'Asia/Almaty'],
    ['Магазины (ID)', descriptor.storeIds.join('; ')], ['Статус', descriptor.status], ['Город', descriptor.city], ['Поиск', descriptor.q], ['Группировка', descriptor.group], ['Сортировка', descriptor.sort],
    ['Заказов', orders.length], ['Строк отчёта', rows.length], ['Завершённых заказов', completed.length], ['Сумма завершённых KZT', total.value], ['Известная сумма завершённых KZT', total.knownSum], ['Завершённых без суммы', total.missing],
    ['Средний чек известных KZT', total.priced ? total.knownSum / total.priced : null], ['Доступность денег', 'Пустая числовая ячейка означает нет данных; настоящий 0 сохранён. Известная сумма не является полным итогом при пропусках.'],
    ['Финансовый охват', 'Суммы импортированных завершённых заказов, не выплаты Kaspi. Комиссия, налог, COGS и чистая прибыль недоступны. Доставка продавца не комиссия.'],
    ['Товары', 'Позиции всех отфильтрованных заказов. offer/catalog/entry не подтверждённый seller SKU; не складские остатки. PIECES и WEIGHT_VOLUME не смешиваются; неизвестная единица не означает штуки. Сортировка по количеству не делает единицы сопоставимыми.'],
    ['Охват', 'Только сохранённый импорт Kaspi; импорт ограничен последними 14 днями. Не полная история. Регенерация читает текущие данные; архив файла отсутствует.'],
    ['Неполные позиции заказов', orders.filter(o => !o.entriesComplete).length], ['Предупреждения', warnings.join('; ')]
  ];
  return { columns, rows, metadata };
};
