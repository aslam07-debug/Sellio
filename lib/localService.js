import { authenticate, ownedStore } from './kaspiService.js';
import { KaspiError, decryptToken, kaspiClient, privateKey } from './kaspi.js';
import { LOW_STOCK_THRESHOLD, stockDto, validPrice, validUnits, validStockVersion } from './stockData.js';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const fail = (message, status = 400) => { throw new KaspiError(message, status); };
const dbCheck = error => { if (error) fail('Данные недоступны. Проверьте существующую схему и повторите запрос.', 503); };
const idValid = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
const fieldsOnly = (input, allowed) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) fail('Недопустимые поля запроса.'); };
export const readLocalBody = async request => {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') fail('Ожидается JSON.', 415);
  const reader = request.body?.getReader(); if (!reader) fail('Пустой запрос.');
  let text = '', size = 0, expired = false; const decoder = new TextDecoder();
  const timeout = setTimeout(() => { expired = true; reader.cancel().catch(() => {}); }, 5000);
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 16384) { await reader.cancel(); fail('Запрос слишком большой.', 413); } text += decoder.decode(part.value, { stream: true }); }
    if (expired) fail('Истекло время чтения запроса.', 408);
    text += decoder.decode();
  } finally { clearTimeout(timeout); }
  try { return JSON.parse(text); } catch { fail('Некорректный JSON.'); }
};
const queryInput = (url, allowed) => {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) fail('Недопустимые параметры запроса.');
  return Object.fromEntries(params);
};
export const nextLocalVersion = (raw, now = Date.now()) => {
  const previous = validStockVersion(raw) ? Date.parse(raw) : NaN;
  const date = new Date(Math.max(now, previous + 1));
  if (!Number.isFinite(previous) || !Number.isFinite(date.getTime())) fail('Проверьте updated_at и точность времени в существующей схеме.', 503);
  return date.toISOString();
};
export const readStockRows = async (admin, storeId) => {
  const rows = [], deadline = Date.now() + 20000; let count;
  for (let offset = 0; offset <= 10000; offset += 1000) {
    if (Date.now() > deadline) fail('Чтение занимает слишком долго. Повторите запрос.', 503);
    const result = await admin.from('stock').select('id,store_id,sku,model,base_stock,sold_since_base,price,available,updated_at', { count: 'exact' }).eq('store_id', storeId).order('id', { ascending: true }).range(offset, offset + 999);
    dbCheck(result.error);
    if (!Number.isSafeInteger(result.count) || result.count < 0 || !Array.isArray(result.data) || result.data.length > 1000) fail('Не удалось проверить полный счётчик остатков.', 503);
    if (result.count > 10000) fail('Более 10 000 строк остатков: безопасный лимит чтения. Частичный итог не показан.', 409);
    if (count !== undefined && count !== result.count) fail('Остатки изменились во время чтения. Обновите данные.', 409);
    count = result.count; rows.push(...result.data);
    if (result.data.length < 1000) {
      if (rows.length !== count || new Set(rows.map(r => String(r.id))).size !== count) fail('Неполное чтение остатков. Проверьте лимит строк Supabase и повторите запрос.', 503);
      return rows;
    }
  }
  fail('Не удалось прочитать полный набор остатков.', 503);
};
const stockOperation = async (request, kind, admin, userId) => {
  const input = request.method === 'GET' ? queryInput(request.url, ['storeId', 'q', 'filter', 'page', 'pageSize']) : await readLocalBody(request);
  const allowed = kind === 'stock' ? ['storeId', 'sku', 'model', 'baseStock', 'price', 'available'] : ['storeId', 'id', 'expectedUpdatedAt', kind === 'rebase' ? 'baseStock' : kind === 'set-price' ? 'price' : 'available', ...(kind === 'rebase' ? ['confirmed'] : [])];
  if (request.method !== 'GET') fieldsOnly(input, allowed);
  if (!idValid(input.storeId)) fail('Выберите магазин.');
  // Independent ownership lookup before every stock read/write.
  const store = await ownedStore(admin, userId, input.storeId);
  if (request.method === 'GET') {
    const q = input.q ?? '', filter = input.filter ?? 'all';
    const parsePage = (value, fallback, max) => { if (value === undefined) return fallback; if (!/^[1-9]\d{0,5}$/.test(value) || Number(value) > max) fail('Некорректная страница.'); return Number(value); };
    const page = parsePage(input.page, 1, 100000), pageSize = parsePage(input.pageSize, 20, 100);
    if (q.length > 100 || !['all', 'active', 'low'].includes(filter)) fail('Некорректные фильтры.');
    const all = (await readStockRows(admin, store.id)).map(stockDto);
    const found = all.filter(r => (!q || `${r.sku ?? ''} ${r.model ?? ''}`.toLocaleLowerCase('ru').includes(q.trim().toLocaleLowerCase('ru'))) && (filter === 'all' || filter === 'active' && r.available === true || filter === 'low' && r.low));
    return { data: found.slice((page - 1) * pageSize, page * pageSize), meta: { total: found.length, totalPages: Math.ceil(found.length / pageSize), page, pageSize, lowCount: all.filter(r => r.low).length, unknownCount: all.filter(r => r.balance === null).length, threshold: LOW_STOCK_THRESHOLD } };
  }
  if (kind === 'stock') {
    if (typeof input.sku !== 'string' || !input.sku.trim() || input.sku.trim().length > 100 || /[\x00-\x1f\x7f]/.test(input.sku) || typeof input.model !== 'string' || !input.model.trim() || input.model.trim().length > 200 || /[\x00-\x1f\x7f]/.test(input.model) || !validUnits(input.baseStock) || !validPrice(input.price) || typeof input.available !== 'boolean') fail('Нужны SKU, название, целый остаток 0–1 млрд ед., цена 0–1 трлн ₸ и логический флаг доступности.');
    const result = await admin.from('stock').upsert({ store_id: store.id, sku: input.sku.trim(), model: input.model.trim(), base_stock: input.baseStock, sold_since_base: 0, price: input.price, available: input.available, updated_at: new Date().toISOString() }, { onConflict: 'store_id,sku', ignoreDuplicates: true }).select('id,store_id,sku,model,base_stock,sold_since_base,price,available,updated_at').maybeSingle();
    if (result.error?.code === '42P10') fail('Требуется существующая уникальность stock(store_id,sku). Согласуйте с администратором; строка не добавлена.', 409);
    if (result.error?.code === '23505') fail('SKU уже существует. Обновите список.', 409);
    dbCheck(result.error); if (!result.data) fail('SKU уже существует. Обновите список; прежняя строка сохранена.', 409);
    return { data: stockDto(result.data) };
  }
  if (!idValid(input.id) || !validStockVersion(input.expectedUpdatedAt)) fail('Нужны ID строки и корректная версия updated_at.');
  if (kind === 'rebase' && (!validUnits(input.baseStock) || input.confirmed !== true) || kind === 'set-price' && !validPrice(input.price) || kind === 'toggle' && typeof input.available !== 'boolean') fail('Некорректное значение или нет подтверждения пересчёта.');
  const current = await admin.from('stock').select('id,updated_at').eq('store_id', store.id).eq('id', input.id).maybeSingle();
  dbCheck(current.error); if (!current.data) fail('Строка остатков не найдена.', 404);
  if (current.data.updated_at !== input.expectedUpdatedAt) fail('Строка изменилась. Обновите данные и повторите действие.', 409);
  const update = { ...(kind === 'rebase' ? { base_stock: input.baseStock, sold_since_base: 0 } : kind === 'set-price' ? { price: input.price } : { available: input.available }), updated_at: nextLocalVersion(current.data.updated_at) };
  const result = await admin.from('stock').update(update).eq('store_id', store.id).eq('id', input.id).eq('updated_at', input.expectedUpdatedAt).select('id,store_id,sku,model,base_stock,sold_since_base,price,available,updated_at').maybeSingle();
  dbCheck(result.error); if (!result.data) fail('Строка изменилась. Обновите данные.', 409);
  return { data: stockDto(result.data) };
};
const publicProfile = (row, user) => ({ id: String(user.id), email: typeof user.email === 'string' ? user.email : null,
  name: typeof row?.name === 'string' ? row.name : typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : '',
  nameSource: typeof row?.name === 'string' ? 'users' : 'auth-metadata', plan: typeof row?.plan === 'string' && row.plan ? row.plan : null, profileExists: Boolean(row) });
const settingsOperation = async (request, kind, admin, userId, client) => {
  if (kind === 'profile') {
    queryInput(request.url, []);
    const row = await admin.from('users').select('id,name,plan').eq('id', userId).maybeSingle(); dbCheck(row.error);
    const auth = await admin.auth.getUser(request.headers.get('authorization').slice(7));
    if (auth.error || auth.data?.user?.id !== userId) fail('Сессия истекла. Войдите заново.', 401);
    if (request.method === 'GET') return { data: publicProfile(row.data, auth.data.user) };
    const input = await readLocalBody(request); fieldsOnly(input, ['name']);
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100 || /[\x00-\x1f\x7f]/.test(input.name)) fail('Имя должно содержать 1–100 символов.');
    if (!row.data) fail('Профиль users отсутствует. Администратор должен подтвердить существующее создание профиля; тариф не изменён.', 409);
    const result = await admin.from('users').update({ name: input.name.trim() }).eq('id', userId).select('id,name,plan').maybeSingle(); dbCheck(result.error);
    if (!result.data) fail('Профиль изменился или удалён. Обновите данные.', 409);
    return { data: publicProfile(result.data, auth.data.user) };
  }
  if (request.method === 'GET') {
    queryInput(request.url, []);
    const result = await admin.from('stores').select('id,name,marketplace,created_at,api_token_encrypted').eq('user_id', userId).eq('marketplace', 'kaspi').order('id', { ascending: true }).limit(101); dbCheck(result.error);
    if (!Array.isArray(result.data)) fail('Магазины недоступны.', 503);
    if (result.data.length > 100) fail('Достигнут лимит 100 магазинов.', 409);
    return { data: result.data.map(r => ({ id: String(r.id), name: typeof r.name === 'string' ? r.name : '', marketplace: 'kaspi', createdAt: typeof r.created_at === 'string' ? r.created_at : null, hasToken: typeof r.api_token_encrypted === 'string' && r.api_token_encrypted.length > 0 })) };
  }
  const input = await readLocalBody(request); fieldsOnly(input, ['storeId', 'action', ...(kind === 'settings-stores' ? ['confirmed'] : [])]);
  if (!idValid(input.storeId) || !['check', 'disconnect'].includes(input.action)) fail('Некорректное действие.');
  const store = await ownedStore(admin, userId, input.storeId);
  const envelope = store.api_token_encrypted;
  if (input.action === 'check') {
    await client.verifyToken(decryptToken(envelope, privateKey()));
    const latest = await ownedStore(admin, userId, input.storeId);
    if (latest.api_token_encrypted !== envelope) fail('Подключение изменилось. Повторите проверку.', 409);
    return { data: { id: String(store.id), connected: true, checkedAt: new Date().toISOString() } };
  }
  if (input.confirmed !== true) fail('Подтвердите отключение. Заказы и остатки сохранятся.');
  if (store.api_token_encrypted === null) return { data: { id: String(store.id), disconnected: true } };
  if (typeof store.api_token_encrypted !== 'string' || !store.api_token_encrypted) fail('Некорректная версия подключения. Проверьте схему.', 409);
  const result = await admin.from('stores').update({ api_token_encrypted: null }).eq('id', store.id).eq('user_id', userId).eq('marketplace', 'kaspi').eq('api_token_encrypted', store.api_token_encrypted).select('id').maybeSingle();
  dbCheck(result.error); if (!result.data) fail('Подключение изменилось. Обновите список перед отключением.', 409);
  return { data: { id: String(store.id), disconnected: true } };
};
export const handleLocal = async (request, kind, admin, client = kaspiClient) => {
  try {
    const userId = await authenticate(request, admin);
    const methods = kind === 'profile' ? ['GET', 'PATCH'] : ['stock', 'settings-stores'].includes(kind) ? ['GET', 'POST'] : ['POST'];
    if (!methods.includes(request.method)) fail('Метод недоступен.', 405);
    if (request.method !== 'GET') queryInput(request.url, []);
    const result = ['stock', 'rebase', 'set-price', 'toggle'].includes(kind) ? await stockOperation(request, kind, admin, userId) : await settingsOperation(request, kind, admin, userId, client);
    return Response.json(result, { headers });
  } catch (error) { return Response.json({ error: error instanceof KaspiError ? error.message : 'Не удалось выполнить запрос. Повторите позже.' }, { status: error instanceof KaspiError ? error.status : 503, headers }); }
};
