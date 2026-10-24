import { authenticate } from './kaspiService.js';
import { KaspiError } from './kaspi.js';
import { ReportError, parseReportQuery, filterOrders, buildReports, ordersCsv, sanitizeOrder } from './reportData.js';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const dbFailure = () => { throw new ReportError('Не удалось прочитать данные. Проверьте существующую схему и повторите запрос.', 503); };
export const reportStore = async (admin, userId, storeId) => {
  const result = await admin.from('stores').select('id,name,marketplace').eq('id', storeId).eq('user_id', userId).eq('marketplace', 'kaspi').maybeSingle();
  if (result.error) dbFailure();
  if (!result.data) throw new ReportError('Магазин Kaspi не найден.', 404);
  return result.data;
};
export const readImportedOrders = async (admin, storeId) => {
  const rows = [], deadline = Date.now() + 20000;
  for (let offset = 0; offset <= 10000; offset += 1000) {
    if (Date.now() > deadline) throw new ReportError('Чтение занимает слишком долго. Повторите запрос.', 503);
    const { data, error } = await admin.from('orders').select('id,store_id,order_code,status,data,comment,updated_at').eq('store_id', storeId).order('id', { ascending: true }).range(offset, offset + 999);
    if (error || !Array.isArray(data) || data.length > 1000) dbFailure();
    if (offset === 10000 && data.length) throw new ReportError('Более 10 000 сохранённых заказов: безопасный лимит чтения. Отчёт и экспорт не сформированы; обратитесь к администратору.', 409);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
  return rows;
};
export const handleReport = async (request, kind, admin) => {
  try {
    const userId = await authenticate(request, admin);
    if (kind === 'stores') {
      const { data, error } = await admin.from('stores').select('id,name,marketplace').eq('user_id', userId).eq('marketplace', 'kaspi').order('id', { ascending: true }).limit(101);
      if (error || !Array.isArray(data)) dbFailure();
      if (data.length > 100) throw new ReportError('Достигнут лимит 100 магазинов.', 409);
      return Response.json({ data: data.map(s => ({ id: String(s.id), name: s.name, marketplace: 'kaspi' })) }, { headers });
    }
    const query = parseReportQuery(request.url, { orders: kind === 'orders' });
    await reportStore(admin, userId, query.storeId);
    if (request.method === 'PATCH') {
      if (kind !== 'orders') throw new ReportError('Метод недоступен.', 405);
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new ReportError('Ожидается JSON.', 415);
      const reader = request.body?.getReader();
      if (!reader) throw new ReportError('Пустой запрос.');
      const chunks = [], timeout = setTimeout(() => reader.cancel(), 5000); let size = 0;
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 16384) { await reader.cancel(); throw new ReportError('Запрос слишком большой.', 413); } chunks.push(value); }
      } finally { clearTimeout(timeout); }
      const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
      let input; try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ReportError('Некорректный JSON.'); }
      if (!input || Array.isArray(input) || Object.keys(input).some(k => !['id', 'comment', 'expectedUpdatedAt'].includes(k)) || typeof input.id !== 'string' || !input.id || input.id.length > 200 || typeof input.comment !== 'string' || input.comment.length > 2000 || typeof input.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) throw new ReportError('Нужны ID заказа, комментарий до 2000 символов и текущая версия updated_at.');
      const existing = await admin.from('orders').select('id,updated_at').eq('store_id', query.storeId).eq('id', input.id).maybeSingle();
      if (existing.error) dbFailure();
      if (!existing.data) throw new ReportError('Заказ не найден.', 404);
      if (existing.data.updated_at !== input.expectedUpdatedAt) throw new ReportError('Заказ изменился. Обновите данные перед сохранением комментария.', 409);
      const previousVersion = Date.parse(existing.data.updated_at);
      // Advance the CAS version even when the server clock matches or trails it.
      const updatedAt = new Date(Math.max(Date.now(), previousVersion + 1));
      if (!Number.isFinite(previousVersion) || !Number.isFinite(updatedAt.getTime())) throw new ReportError('Не удалось обновить версию заказа. Проверьте updated_at в существующей схеме.', 503);
      const result = await admin.from('orders').update({ comment: input.comment, updated_at: updatedAt.toISOString() }).eq('store_id', query.storeId).eq('id', input.id).eq('updated_at', input.expectedUpdatedAt).select('id,comment,updated_at').maybeSingle();
      if (result.error) dbFailure();
      if (!result.data) throw new ReportError('Заказ изменился. Обновите данные.', 409);
      return Response.json({ data: { id: String(result.data.id), comment: result.data.comment, updatedAt: result.data.updated_at } }, { headers });
    }
    const rows = await readImportedOrders(admin, query.storeId);
    const orders = filterOrders(rows, query);
    const invalidDates = rows.filter(row => sanitizeOrder(row).creationDate === null).length;
    const warnings = invalidDates ? [`У ${invalidDates} сохранённых заказов отсутствует корректная дата создания: они исключены из периода.`] : [];
    if (kind === 'orders') {
      if (query.format === 'csv') return new Response(ordersCsv(orders), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sellio-orders-${query.start}-${query.end}.csv"` } });
      const total = orders.length, totalPages = Math.ceil(total / query.pageSize);
      return Response.json({ data: orders.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), meta: { total, page: query.page, pageSize: query.pageSize, totalPages,
        cities: [...new Set(filterOrders(rows, { ...query, city: '', status: '', q: '' }).map(o => o.city))].sort(), warnings, coverage: 'По импортированным заказам; не полная история.' } }, { headers });
    }
    const reports = buildReports(orders, query);
    reports.summary.warnings.push(...warnings);
    return Response.json({ data: reports[kind] }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof ReportError || error instanceof KaspiError ? error.message : 'Не удалось выполнить запрос. Повторите позже.' }, { status: error instanceof ReportError || error instanceof KaspiError ? error.status : 503, headers });
  }
};
