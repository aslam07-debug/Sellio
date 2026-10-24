// Public illustrations only. No customer data, credentials or network requests.
export const demoOrders = [
  { code: 'DEMO-01', product: 'Настольная лампа', city: 'Алматы', status: 'completed', amount: 18000 },
  { code: 'DEMO-02', product: 'Органайзер', city: 'Астана', status: 'completed', amount: 12000 },
  { code: 'DEMO-03', product: 'Настольная лампа', city: 'Алматы', status: 'delivery', amount: 18000 },
  { code: 'DEMO-04', product: 'Термокружка', city: 'Шымкент', status: 'completed', amount: 9000 },
  { code: 'DEMO-05', product: 'Органайзер', city: 'Астана', status: 'cancelled', amount: 12000 },
  { code: 'DEMO-06', product: 'Термокружка', city: 'Алматы', status: 'completed', amount: 9000 }
];
export const statuses = { all: 'Все статусы', completed: 'Завершён', delivery: 'В доставке', cancelled: 'Отменён' };
export const demoCities = ['all', ...new Set(demoOrders.map((order) => order.city))];
export const number = (value) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
export const money = (value) => `${number(value)} ₸`;
export function summarizeDemo(status = 'all', city = 'all') {
  const orders = demoOrders.filter((order) => (status === 'all' || order.status === status) && (city === 'all' || order.city === city));
  const completed = orders.filter((order) => order.status === 'completed');
  const amount = completed.reduce((total, order) => total + order.amount, 0);
  return { orders, count: orders.length, completed: completed.length, amount, average: completed.length ? amount / completed.length : 0,
    cities: demoCities.slice(1).map((name) => ({ name, count: orders.filter((order) => order.city === name).length })) };
}
export function estimateRoutine(hours, hourlyValue) {
  const parse = (value, max) => {
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
  };
  const weekly = parse(hours, 168);
  const rate = parse(hourlyValue, 1000000);
  if (weekly === null || rate === null) return null;
  return { monthly: weekly * 52 / 12, annual: weekly * 52, annualValue: weekly * 52 * rate };
}
export const features = [
  { id: 'orders', name: 'Заказы', title: 'От статуса до комментария — в одном списке', description: 'Просматривайте импортированные заказы Kaspi, ищите нужный заказ, фильтруйте статусы и сохраняйте внутренние комментарии. CSV и Excel (.xlsx) — для дальнейшей работы вне кабинета.', points: ['Поиск и фильтры', 'Внутренние комментарии', 'Экспорт CSV / XLSX'] },
  { id: 'analytics', name: 'Аналитика', title: 'Цифры с понятным источником', description: 'Сумма завершённых заказов, средний чек, статусы и товары строятся по импортированным данным. Сумма заказов не равна прибыли: комиссии и расходы здесь не рассчитываются.', points: ['Сумма завершённых заказов', 'Средний чек', 'Товары из заказов, не полный каталог'] },
  { id: 'cities', name: 'Города', title: 'Понимайте, откуда приходят заказы', description: 'Сравнивайте количество импортированных заказов по городам. Это отчёт по данным заказов, а не карта покрытия или прогноз спроса.', points: ['Группировка по городу', 'Выбранный период', 'Без выдуманной географии'] },
  { id: 'stock', name: 'Ручные остатки', title: 'Свой учёт, без иллюзии синхронизации', description: 'Добавьте собственный SKU и измеренный остаток, подтвердите новый базовый остаток, ведите локальные цены и активность. Данные склада Kaspi не загружаются, импорт заказов не уменьшает остаток автоматически.', points: ['Ручной базовый остаток', 'Локальная цена', 'Подтверждение изменения базы'] }
];
export const faqs = [
  ['Какие маркетплейсы поддерживаются?', 'В текущем MVP поддерживается Kaspi. Ozon и Wildberries не подключены. Sellio не изменяет заказы, цены или остатки на стороне Kaspi.'],
  ['Как подключить Kaspi?', 'После регистрации укажите токен API Kaspi в кабинете. Сервер проверит его реальным запросом. Для подключения должны быть настроены Supabase, существующая база данных и приватный ключ шифрования на сервере.'],
  ['За какой период загружаются заказы?', 'Первый импорт охватывает фиксированное окно в 14 дней. Его можно приостановить и продолжить по сохранённому курсору. Импорт работает при открытом цикле запросов во вкладке; фонового обновления каждые 30 минут нет.'],
  ['Остатки синхронизируются автоматически?', 'Нет. В текущей версии остатки ведутся вручную в Sellio. Импорт заказов не изменяет базовый остаток, счётчик продаж или цены. Подтверждённого публичного API складских остатков Kaspi здесь нет.'],
  ['Где хранятся данные и токен?', 'Импортированные заказы хранятся в Supabase. Сервер проверяет владельца магазина для каждого запроса; перед запуском администратор должен настроить и проверить RLS. Токен Kaspi шифруется на сервере. Данные не хранятся в Google Sheets, абсолютной гарантии безопасности нет.'],
  ['Что означает выбор платного тарифа?', 'Цены Про и Бизнес, периоды оплаты и лимиты ожидают подтверждения. Выбор сохраняется как requested_plan — пожелание пользователя. Он не меняет фактический users.plan, не списывает деньги и не даёт платных прав. Биллинг и тарифные ограничения не реализованы.'],
  ['Можно ли выгрузить данные?', 'Есть отдельная страница экспорта CSV и Excel (.xlsx): заказы, суммы завершённых заказов и товары в заказах. История хранит параметры; регенерация читает текущие данные. Email, PDF и Google Sheets не реализованы. Отчёт показывает доступный импорт, не гарантированно полный внешний снимок.'],
  ['Уже есть Telegram, накладные и управление ценами?', 'Нет. Telegram, накладные, ценовые правила и автоматическое обновление поздних возвратов между месяцами — отложенные возможности. Сроки их выпуска пока не подтверждены.']
];
