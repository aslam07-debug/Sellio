// Server-side only: imported by API services, never by client components.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const KASPI_STATES = ['NEW', 'SIGN_REQUIRED', 'PICKUP', 'DELIVERY', 'KASPI_DELIVERY', 'ARCHIVE'];
export const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const BASE = 'https://kaspi.kz/shop/api/v2';
const MEDIA = 'application/vnd.api+json';
export class KaspiError extends Error {
  constructor(message, status = 502, code) { super(message); this.status = status; this.code = code; }
}
const invalid = () => new KaspiError('Kaspi вернул неполные данные. Импорт не завершён; попробуйте снова.');
export const privateKey = (encoded = process.env.KASPI_TOKEN_ENCRYPTION_KEY) => {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new KaspiError('Сервер подключения Kaspi не настроен.', 503);
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new KaspiError('Сервер подключения Kaspi не настроен.', 503);
  return key;
};
export const encryptToken = (token, key) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
};
export const decryptToken = (value, key) => {
  try {
    if (typeof value !== 'string' || value.length > 12000) throw Error();
    const [version, iv, tag, text, extra] = value.split('.');
    if (version !== 'v1' || extra || !iv || !tag || !text) throw Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(text, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new KaspiError('Не удалось прочитать сохранённый токен. Подключите магазин заново.', 409); }
};
export const credentialFingerprint = (envelope) => {
  if (typeof envelope !== 'string' || !envelope || envelope.length > 12000) {
    throw new KaspiError('Подключение Kaspi недоступно. Подключите магазин заново.', 409, 'KASPI_RESTART_REQUIRED');
  }
  return createHash('sha256').update(envelope, 'utf8').digest('hex');
};
export const assertCredential = (run, envelope) => {
  if (run.credentialFingerprint !== credentialFingerprint(envelope)) {
    throw new KaspiError('Подключение Kaspi изменилось. Начните новый импорт.', 409, 'KASPI_RESTART_REQUIRED');
  }
};
export const signCursor = (payload, key) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', key).update('sellio-kaspi-cursor-v1.' + body).digest('base64url');
  return `${body}.${signature}`;
};
export const readCursor = (cursor, key, userId, storeId, envelope, now = Date.now()) => {
  let p;
  try {
    if (typeof cursor !== 'string' || cursor.length > 4096) throw Error();
    const [body, signature, extra] = cursor.split('.');
    if (extra || !body || !signature) throw Error();
    const expected = createHmac('sha256', key).update('sellio-kaspi-cursor-v1.' + body).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw Error();
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p.v !== 1 || p.userId !== userId || p.storeId !== storeId || !/^[a-f0-9]{32}$/.test(p.runId)
      || typeof p.credentialFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(p.credentialFingerprint)
      || !Number.isSafeInteger(p.end) || p.end > now || p.start !== p.end - WINDOW_MS
      || !Number.isSafeInteger(p.expires) || p.expires <= now || p.expires > p.end + 86400000
      || !Number.isInteger(p.state) || p.state < 0 || p.state > 6
      || !Number.isInteger(p.page) || p.page < 0 || p.page >= 1000
      || !Number.isInteger(p.processedPages) || p.processedPages < 0 || p.processedPages > 6000) throw Error();
  } catch { throw new KaspiError('Ссылка продолжения недействительна или истекла. Начните новый импорт.', 409, 'KASPI_RESTART_REQUIRED'); }
  assertCredential(p, envelope);
  return p;
};
export const newRun = (userId, storeId, envelope, now = Date.now()) => ({
  v: 1, userId, storeId, runId: randomBytes(16).toString('hex'), start: now - WINDOW_MS,
  credentialFingerprint: credentialFingerprint(envelope),
  end: now, expires: now + 86400000, state: 0, page: 0, processedPages: 0
});

export const validateCollection = (json, page, size, enforceImportLimits = true) => {
  const { data, meta } = json ?? {};
  if (!Array.isArray(data) || data.length > size || !meta
    || !Number.isSafeInteger(meta.pageCount) || meta.pageCount < 0
    || !Number.isSafeInteger(meta.totalCount) || meta.totalCount < 0
    || meta.pageCount !== Math.ceil(meta.totalCount / size)
    || (meta.totalCount === 0 && (page !== 0 || data.length !== 0))
    || (meta.totalCount > 0 && (page >= meta.pageCount || data.length !== Math.min(size, meta.totalCount - page * size)))
    || (json.included !== undefined && (!Array.isArray(json.included) || json.included.length > 5000))) throw invalid();
  if (enforceImportLimits && (meta.pageCount > 1000 || meta.totalCount > 100000)) {
    throw new KaspiError('Достигнут безопасный лимит импорта; данные неполны.', 409);
  }
  for (const order of data) {
    const a = order?.attributes;
    if (order?.type !== 'orders' || typeof order.id !== 'string' || !order.id || order.id.length > 512
      || !a || typeof a.code !== 'string' || !a.code || a.code.length > 200
      || typeof a.status !== 'string' || !a.status || a.status.length > 100
      || !Number.isSafeInteger(a.creationDate) || a.creationDate < 0
      || !Number.isFinite(a.totalPrice) || a.totalPrice < 0) throw invalid();
  }
  return json;
};

export const kaspiClient = {
  async getOrders(token, { state, page = 0, size = 100, start, end, enforceImportLimits = true }, fetcher = fetch) {
    if (!KASPI_STATES.includes(state) || !Number.isInteger(page) || page < 0 || page >= 1000
      || !Number.isInteger(size) || size < 1 || size > 100 || !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end) || start < 0 || end - start !== WINDOW_MS) throw invalid();
    const url = new URL(`${BASE}/orders`);
    for (const [name, value] of Object.entries({
      'page[number]': page, 'page[size]': size, 'filter[orders][state]': state,
      'filter[orders][creationDate][$ge]': start, 'filter[orders][creationDate][$le]': end,
      'include[orders]': 'entries'
    })) url.searchParams.set(name, value);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      let retryDelay;
      try {
        const response = await fetcher(url.toString(), {
          headers: { 'Content-Type': MEDIA, Accept: MEDIA, 'X-Auth-Token': token },
          cache: 'no-store', redirect: 'error', signal: controller.signal
        });
        if (response.status === 401 || response.status === 403) {
          throw new KaspiError('Kaspi отклонил токен или права доступа. Проверьте токен и разрешения.', 422);
        }
        if (response.status === 429 || response.status >= 500) {
          const header = response.headers.get('retry-after');
          const seconds = /^\d+$/.test(header ?? '') ? Number(header) : 0;
          retryDelay = Math.min(1500, Math.max(200 * (attempt + 1), seconds * 1000));
          await response.body?.cancel();
          if (attempt === 2) throw new KaspiError('Kaspi временно недоступен или ограничил запросы. Повторите позже.', 503);
        } else {
          if (response.status !== 200) throw new KaspiError('Не удалось получить заказы Kaspi. Проверьте доступ и повторите запрос.');
          // Bound streamed bytes, not only Content-Length (which may be absent).
          const reader = response.body?.getReader();
          if (!reader) throw invalid();
          const decoder = new TextDecoder();
          let text = '', bytes = 0;
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.length;
            if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw invalid(); }
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
          let json;
          try { json = JSON.parse(text); } catch { throw invalid(); }
          return validateCollection(json, page, size, enforceImportLimits);
        }
      } catch (error) {
        if (error instanceof KaspiError) throw error;
        if (attempt === 2) throw new KaspiError('Соединение с Kaspi прервано. Импорт не завершён; повторите запрос.', 503);
        retryDelay = 200 * (attempt + 1);
      } finally { clearTimeout(timeout); }
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  },
  async verifyToken(token, fetcher = fetch, now = Date.now()) {
    await this.getOrders(token, { state: 'NEW', page: 0, size: 100, start: now - WINDOW_MS, end: now, enforceImportLimits: false }, fetcher);
    return true;
  }
};

export const normalizeOrders = (collection, run) => {
  const included = new Map((collection.included ?? []).filter((entry) => entry.type === 'orderentries').map((entry) => [entry.id, entry]));
  const byCode = new Map();
  const resourceIds = new Set();
  for (const order of collection.data) {
    const a = order.attributes;
    if (a.creationDate < run.start || a.creationDate > run.end || resourceIds.has(order.id)) continue;
    resourceIds.add(order.id);
    const refs = order.relationships?.entries?.data;
    if (refs !== undefined && (!Array.isArray(refs) || refs.length > 5000)) throw invalid();
    const entries = (refs ?? []).map((ref) => {
      const entry = included.get(ref.id);
      if (!entry) return null;
      const fields = entry.attributes ?? {};
      const productId = entry.relationships?.product?.data?.id;
      return {
        id: entry.id, productId: typeof productId === 'string' && productId.length <= 512 ? productId : null,
        orderedQuantity: Number.isFinite(fields.quantity) && fields.quantity >= 0 ? fields.quantity : null,
        unitType: ['PIECES', 'WEIGHT_VOLUME'].includes(fields.unitType) ? fields.unitType : null,
        name: typeof fields.offer?.name === 'string' && fields.offer.name.length <= 512 ? fields.offer.name : null,
        offerCode: typeof fields.offer?.code === 'string' && fields.offer.code.length <= 512 ? fields.offer.code : null,
        totalPrice: Number.isFinite(fields.totalPrice) ? fields.totalPrice : null,
        basePrice: Number.isFinite(fields.basePrice) ? fields.basePrice : null, entryNumber: fields.entryNumber ?? null
      };
    }).filter(Boolean);
    byCode.set(a.code, {
      order_code: a.code, status: a.status,
      kaspi: { resourceId: order.id, code: a.code, state: a.state ?? null, status: a.status,
        creationDate: a.creationDate, totalPrice: a.totalPrice, entries,
        city: typeof a.deliveryAddress?.town === 'string' && a.deliveryAddress.town.length <= 200 ? a.deliveryAddress.town : null,
        deliveryMode: typeof a.deliveryMode === 'string' && a.deliveryMode.length <= 100 ? a.deliveryMode : null,
        isKaspiDelivery: typeof a.isKaspiDelivery === 'boolean' ? a.isKaspiDelivery : null,
        deliveryCostForSeller: Number.isFinite(a.deliveryCostForSeller) ? a.deliveryCostForSeller : null,
        deliveryCost: Number.isFinite(a.deliveryCost) ? a.deliveryCost : null,
        paymentMode: typeof a.paymentMode === 'string' && a.paymentMode.length <= 100 ? a.paymentMode : null,
        creditTerm: Number.isFinite(a.creditTerm) ? a.creditTerm : null,
        entriesComplete: Array.isArray(refs) && entries.length === refs.length, runId: run.runId }
    });
  }
  return [...byCode.values()];
};
