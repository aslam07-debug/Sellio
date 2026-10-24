import { dateKey, defaultPeriod, shiftDay } from './reportView.js';

export const exportLabels = { orders: 'Отчёт по заказам', finance: 'Суммы завершённых заказов', products: 'Товары в заказах' };
export const exportContextKey = (session, storeId, period, filters) => JSON.stringify([session?.user?.id, session?.access_token, storeId, period.start, period.end, filters]);
export const exportPreset = (preset, now = Date.now()) => {
  const end = dateKey(now), monthStart = `${end.slice(0, 7)}-01`;
  if (preset === 'last14') return defaultPeriod(now);
  if (preset === 'month') return { start: monthStart, end };
  if (preset === 'previous') { const previousEnd = shiftDay(monthStart, -1); return { start: `${previousEnd.slice(0, 7)}-01`, end: previousEnd }; }
  return null;
};
