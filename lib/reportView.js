export const money = value => value === null || value === undefined ? 'Нет данных' : `${new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 }).format(value)} ₸`;
export const dateKey = value => {
  if (!Number.isFinite(value)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = name => parts.find(p => p.type === name)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
export const orderDate = value => Number.isFinite(value) ? new Intl.DateTimeFormat('ru-KZ', { timeZone: 'Asia/Almaty', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value) : 'Дата неизвестна';
export const shiftDay = (key, days) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const defaultPeriod = (now = Date.now()) => { const end = dateKey(now); return { start: shiftDay(end, -13), end }; };
export const statuses = { completed: 'Завершён', cancelled: 'Отменён', returned: 'Возврат', pending: 'В работе', unknown: 'Неизвестный статус' };
export const deliveryLabel = order => {
  if (order.deliveryMode === 'DELIVERY_PICKUP') return order.isKaspiDelivery === true ? 'Постомат' : order.isKaspiDelivery === false ? 'Самовывоз' : 'Получение: тип неизвестен';
  return { DELIVERY_LOCAL: 'Местная доставка', DELIVERY_REGIONAL_TODOOR: 'До двери', DELIVERY_REGIONAL_PICKUP: 'Региональная выдача' }[order.deliveryMode] ?? 'Нет данных';
};
export const paymentLabel = value => ({ PAY_WITH_CREDIT: 'Кредит', PREPAID: 'Безналичная оплата' }[value] ?? 'Нет данных');
// Aborting is best-effort; identity also blocks responses that already resolved.
export const createRequestGate = () => {
  let version = 0, controller;
  return { cancel() { version += 1; controller?.abort(); }, begin() {
    controller?.abort(); controller = new AbortController(); const identity = ++version;
    return { signal: controller.signal, current: () => identity === version && !controller.signal.aborted };
  } };
};
