import { assertCredential, decryptToken, encryptToken, kaspiClient, KaspiError, KASPI_STATES, newRun, normalizeOrders, readCursor, signCursor, validateCollection } from './kaspi.js';

const dbError = (error) => {
  if (error.code === '42P10') throw new KaspiError('В существующей orders требуется уникальность (store_id, order_code). Согласуйте её с администратором; импорт не завершён.', 409);
  throw new KaspiError('Не удалось сохранить или прочитать данные. Проверьте существующую схему и повторите запрос.', 503);
};
export const ownedStore = async (admin, userId, storeId) => {
  const { data, error } = await admin.from('stores').select('id,name,marketplace,api_token_encrypted').eq('id', storeId).eq('user_id', userId).maybeSingle();
  if (error) dbError(error);
  if (!data || data.marketplace !== 'kaspi') throw new KaspiError('Магазин Kaspi не найден.', 404);
  return data;
};
export const authenticate = async (request, admin) => {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ') || header.length > 8192 || header.length <= 7) throw new KaspiError('Войдите в Sellio.', 401);
  if (!admin) throw new KaspiError('Сервер подключения не настроен.', 503);
  const { data, error } = await admin.auth.getUser(header.slice(7));
  if (error || !data?.user?.id) throw new KaspiError('Сессия истекла. Войдите заново.', 401);
  return data.user.id;
};
export const verifyStore = async ({ admin, userId, key, input, client = kaspiClient }) => {
  const { token, name, storeId } = input;
  if (typeof token !== 'string' || !token.trim() || token.length > 4096 || /[\s\x00-\x1f\x7f]/.test(token)
    || typeof name !== 'string' || !name.trim() || name.trim().length > 100
    || (storeId !== undefined && (typeof storeId !== 'string' || !storeId || storeId.length > 200))) {
    throw new KaspiError('Введите имя магазина (до 100 символов) и корректный API токен.', 400);
  }
  const previousEnvelope = storeId ? (await ownedStore(admin, userId, storeId)).api_token_encrypted : undefined;
  if (storeId && previousEnvelope !== null && (typeof previousEnvelope !== 'string' || !previousEnvelope)) throw new KaspiError('Проверьте версию подключения в существующей схеме.', 409);
  await client.verifyToken(token);
  const fields = { name: name.trim(), marketplace: 'kaspi', api_token_encrypted: encryptToken(token, key) };
  let query = storeId
    ? admin.from('stores').update(fields).eq('id', storeId).eq('user_id', userId).eq('marketplace', 'kaspi')
    : admin.from('stores').insert({ ...fields, user_id: userId });
  if (storeId) query = previousEnvelope === null ? query.is('api_token_encrypted', null) : query.eq('api_token_encrypted', previousEnvelope);
  const { data, error } = await query.select('id,name').maybeSingle();
  if (error) dbError(error);
  if (!data?.id) throw new KaspiError(storeId ? 'Подключение изменилось. Обновите список и повторите подключение.' : 'Магазин не сохранён.', storeId ? 409 : 503);
  return { store: { id: String(data.id), name: data.name, connected: true } };
};

export const persistOrders = async (admin, storeId, orders, now) => {
  if (!orders.length) return;
  const { data, error } = await admin.from('orders').select('order_code,data').eq('store_id', storeId).in('order_code', orders.map((row) => row.order_code));
  if (error) dbError(error);
  const existing = new Map((data ?? []).map((row) => [row.order_code, row.data]));
  const rows = orders.map((order) => {
    const metadata = existing.get(order.order_code);
    if (metadata !== undefined && metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) {
      throw new KaspiError('orders.data должен быть JSON-объектом. Импорт остановлен, чтобы сохранить метаданные.', 409);
    }
    return { store_id: storeId, order_code: order.order_code, status: order.status,
      updated_at: new Date(now).toISOString(), data: { ...metadata, kaspi: { ...metadata?.kaspi, ...order.kaspi } } };
  });
  // Omit id/comment/created_at: existing defaults create IDs and local fields survive conflict updates.
  const result = await admin.from('orders').upsert(rows, { onConflict: 'store_id,order_code', ignoreDuplicates: false });
  if (result.error) dbError(result.error);
};

export const summarizeRun = async (admin, run) => {
  const codes = new Set(), products = new Set();
  const deadline = Date.now() + 20000;
  let totalAmount = 0, completedAmount = 0, completedOrders = 0, entriesComplete = true;
  for (let offset = 0; offset <= 10000; offset += 1000) {
    if (Date.now() >= deadline) throw new KaspiError('Проверка итога занимает слишком долго. Повторите запрос с тем же курсором.', 503);
    const { data, error } = await admin.from('orders').select('order_code,status,data')
      .eq('store_id', run.storeId).eq('data->kaspi->>runId', run.runId)
      .order('order_code', { ascending: true }).range(offset, offset + 999);
    if (error) dbError(error);
    if (!Array.isArray(data) || data.length > 1000) throw new KaspiError('Не удалось проверить итог импорта.', 503);
    if (offset === 10000 && data.length) throw new KaspiError('Более 10 000 заказов: достигнут безопасный лимит. Импорт не завершён.', 409);
    for (const row of data) {
      const k = row.data?.kaspi;
      if (!k || k.runId !== run.runId || !Number.isFinite(k.totalPrice) || !Array.isArray(k.entries)) throw new KaspiError('Сохранённые данные неполны. Импорт не завершён.', 409);
      if (k.creationDate < run.start || k.creationDate > run.end || codes.has(row.order_code)) continue;
      codes.add(row.order_code);
      totalAmount += k.totalPrice;
      if (row.status === 'COMPLETED') { completedAmount += k.totalPrice; completedOrders += 1; }
      entriesComplete &&= k.entriesComplete;
      for (const entry of k.entries) if (entry.productId) products.add(entry.productId);
    }
    if (data.length < 1000) break;
  }
  return { orders: codes.size, observedProducts: products.size, entriesComplete, totalAmount,
    completedAmount, completedOrders, stock: null, start: run.start, end: run.end };
};

export const syncPage = async ({ admin, userId, key, input, client = kaspiClient, now = Date.now() }) => {
  if (typeof input.storeId !== 'string' || !input.storeId || input.storeId.length > 200) throw new KaspiError('Выберите магазин.', 400);
  const store = await ownedStore(admin, userId, input.storeId);
  const run = input.cursor
    ? readCursor(input.cursor, key, userId, input.storeId, store.api_token_encrypted, now)
    : newRun(userId, input.storeId, store.api_token_encrypted, now);
  if (!input.cursor) return { complete: false, cursor: signCursor(run, key), progress: { processedPages: 0, completedStates: 0 } };
  if (run.state === 6) {
    const summary = await summarizeRun(admin, run);
    assertCredential(run, (await ownedStore(admin, userId, input.storeId)).api_token_encrypted);
    return { complete: true, cursor: signCursor(run, key), summary, progress: { processedPages: run.processedPages, completedStates: 6 } };
  }
  const collection = validateCollection(await client.getOrders(decryptToken(store.api_token_encrypted, key), {
    state: KASPI_STATES[run.state], page: run.page, size: 100, start: run.start, end: run.end
  }), run.page, 100);
  // A reconnect can finish while the upstream page is in flight.
  assertCredential(run, (await ownedStore(admin, userId, input.storeId)).api_token_encrypted);
  await persistOrders(admin, input.storeId, normalizeOrders(collection, run), now);
  const next = { ...run, processedPages: run.processedPages + 1 };
  if (run.page + 1 >= collection.meta.pageCount) { next.state += 1; next.page = 0; }
  else next.page += 1;
  if (next.page >= 1000 || next.processedPages > 6000) throw new KaspiError('Достигнут безопасный лимит импорта; данные неполны.', 409);
  return { complete: false, cursor: signCursor(next, key), progress: {
    processedPages: next.processedPages, completedStates: next.state,
    state: KASPI_STATES[run.state], page: run.page + 1, pageCount: collection.meta.pageCount
  } };
};
