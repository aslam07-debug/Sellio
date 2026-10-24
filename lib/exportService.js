import { authenticate } from './kaspiService.js';
import { KaspiError } from './kaspi.js';
import { readLocalBody } from './localService.js';
import { ReportError, filterOrders, sanitizeOrder } from './reportData.js';
import { reportStore } from './reportService.js';
import { EXPORT_MAX_RECORDS, validateExport, validExportId, descriptorQuery, parseExportPeriod, buildExportTable } from './exportData.js';
import { makeExportFile } from './exportFile.js';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const dbFailure = () => { throw new ReportError('Экспорт недоступен. Проверьте существующую схему exports и права доступа; файл не выдан.', 503); };
export const readExportOrders = async (admin, stores) => {
  const result = [], warnings = [], deadline = Date.now() + 20000; let combined = 0;
  for (const store of stores) {
    const rows = []; let count;
    for (let offset = 0; offset <= EXPORT_MAX_RECORDS; offset += 1000) {
      if (Date.now() > deadline) throw new ReportError('Чтение занимает слишком долго. Повторите запрос.', 503);
      const page = await admin.from('orders').select('id,store_id,order_code,status,data,comment,updated_at', { count: 'exact' }).eq('store_id', store.id).order('id', { ascending: true }).range(offset, offset + 999);
      if (page.error || !Array.isArray(page.data) || page.data.length > 1000 || !Number.isSafeInteger(page.count) || page.count < 0) dbFailure();
      if (page.count + combined > EXPORT_MAX_RECORDS) throw new ReportError('Более 10 000 сохранённых заказов в выбранных магазинах. Выберите меньше магазинов или обратитесь к администратору; частичный экспорт не сформирован.', 413);
      if (count !== undefined && count !== page.count) throw new ReportError('Заказы изменились во время чтения. Повторите экспорт.', 409);
      count = page.count; rows.push(...page.data);
      if (page.data.length < 1000) {
        if (rows.length !== count || new Set(rows.map(r => String(r.id))).size !== count || rows.some(r => String(r.store_id) !== String(store.id))) dbFailure();
        break;
      }
    }
    combined += count;
    if (rows.some(r => Array.isArray(r.data?.kaspi?.entries) && r.data.kaspi.entries.length > 5000)) throw new ReportError('Более 5000 позиций в заказе: экспорт остановлен без усечения.', 413);
    const invalid = rows.filter(r => sanitizeOrder(r).creationDate === null).length;
    if (invalid) warnings.push(`Магазин ${String(store.id)}: ${invalid} заказов без корректной даты исключены из периода.`);
    result.push({ store, rows });
  }
  return { result, warnings };
};
const historyDto = row => {
  const descriptor = parseExportPeriod(row.period, row.type);
  return { id: String(row.id), createdAt: typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at)) ? row.created_at : null, type: descriptor?.report ?? 'legacy', descriptor, regenerable: Boolean(descriptor && validExportId(String(row.id))), author: 'Вы' };
};
export const handleExport = async (request, action, admin, historyId) => {
  const allow = action === 'history' ? 'GET' : 'POST';
  if (request.method !== allow) return Response.json({ error: 'Метод недоступен.' }, { status: 405, headers: { ...headers, Allow: allow } });
  try {
    const userId = await authenticate(request, admin);
    const params = new URL(request.url).searchParams;
    if (action === 'history') {
      for (const key of params.keys()) if (key !== 'page' || params.getAll(key).length !== 1) throw new ReportError('Недопустимые параметры истории.');
      const rawPage = params.get('page') ?? '1';
      if (!/^[1-9]\d{0,5}$/.test(rawPage) || Number(rawPage) > 100000) throw new ReportError('Некорректная страница.');
      const page = Number(rawPage), pageSize = 20;
      const response = await admin.from('exports').select('id,type,period,created_at', { count: 'exact' }).eq('user_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
      if (response.error || !Array.isArray(response.data) || response.data.length > pageSize || !Number.isSafeInteger(response.count) || response.count < 0) dbFailure();
      return Response.json({ data: response.data.map(historyDto), meta: { page, pageSize, total: response.count, totalPages: Math.ceil(response.count / pageSize) } }, { headers });
    }
    if ([...params].length) throw new ReportError('Экспорт не принимает параметры URL.');
    const input = await readLocalBody(request); let descriptor;
    if (action === 'regenerate') {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new ReportError('Регенерация принимает пустой JSON-объект.');
      if (!validExportId(historyId)) throw new ReportError('Запись не найдена.', 404);
      const saved = await admin.from('exports').select('id,type,period,created_at').eq('id', historyId).eq('user_id', userId).maybeSingle();
      if (saved.error) dbFailure();
      if (!saved.data) throw new ReportError('Запись не найдена.', 404);
      descriptor = parseExportPeriod(saved.data.period, saved.data.type);
      if (!descriptor) throw new ReportError('Старая или повреждённая запись не поддерживает регенерацию. Сформируйте новый отчёт.', 422);
    } else descriptor = validateExport(input);
    // Authorize every saved/requested store before any order read, on every request.
    const stores = [];
    for (const id of descriptor.storeIds) stores.push(await reportStore(admin, userId, id));
    const { result, warnings } = await readExportOrders(admin, stores), query = descriptorQuery(descriptor);
    const orders = result.flatMap(({ store, rows }) => filterOrders(rows, { ...query, storeId: String(store.id) }).map(o => ({ ...o, storeId: String(store.id), storeName: typeof store.name === 'string' && store.name.length <= 200 ? store.name : 'Магазин Kaspi' })));
    const table = buildExportTable(orders, descriptor, warnings), file = makeExportFile(table, descriptor);
    // Fail closed: bytes are not issued when history persistence fails. No delivery/atomicity claim.
    const saved = await admin.from('exports').insert({ user_id: userId, type: descriptor.report, period: JSON.stringify(descriptor) }).select('id').maybeSingle();
    if (saved.error || !saved.data?.id) dbFailure();
    return new Response(file.bytes, { headers: { ...headers, 'Content-Type': file.mime, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'X-Sellio-History-Saved': '1', 'X-Sellio-Order-Count': String(orders.length), 'X-Sellio-Row-Count': String(table.rows.length) } });
  } catch (error) {
    const safe = error instanceof ReportError || error instanceof KaspiError;
    return Response.json({ error: safe ? error.message : 'Не удалось сформировать экспорт. Повторите позже.' }, { status: safe ? error.status : 503, headers });
  }
};
