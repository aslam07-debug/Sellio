import 'server-only';
import { getSupabaseAdmin } from './supabaseAdmin.js';
import { KaspiError, privateKey } from './kaspi.js';
import { authenticate } from './kaspiService.js';

export const handleKaspi = async (request, operation) => {
  try {
    const admin = getSupabaseAdmin();
    const userId = await authenticate(request, admin);
    const key = privateKey();
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new KaspiError('Ожидается JSON.', 415);
    const reader = request.body?.getReader();
    if (!reader) throw new KaspiError('Пустой запрос.', 400);
    let bytes = 0, body = '';
    const decoder = new TextDecoder();
    const deadline = setTimeout(() => reader.cancel(), 5000);
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 16384) { await reader.cancel(); throw new KaspiError('Запрос слишком большой.', 413); }
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
    } finally { clearTimeout(deadline); }
    let input;
    try { input = JSON.parse(body); } catch { throw new KaspiError('Некорректный JSON.', 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new KaspiError('Некорректный запрос.', 400);
    const allowed = new URL(request.url).pathname.endsWith('/verify') ? ['token', 'name', 'storeId'] : ['storeId', 'cursor'];
    if ([...new URL(request.url).searchParams].length || Object.keys(input).some(field => !allowed.includes(field))) throw new KaspiError('Недопустимые поля запроса.', 400);
    const data = await operation({ admin, userId, key, input });
    return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // Never log credentials or expose upstream/SDK error bodies.
    return Response.json({
      error: error instanceof KaspiError ? error.message : 'Не удалось выполнить запрос. Повторите позже.',
      ...(error instanceof KaspiError && error.code === 'KASPI_RESTART_REQUIRED' ? { code: error.code } : {})
    }, {
      status: error instanceof KaspiError ? error.status : 503, headers: { 'Cache-Control': 'no-store' }
    });
  }
};
