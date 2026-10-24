import DashboardPreview from '@/components/landing/DashboardPreview';

export default function AuthAside() {
  return (
    <aside className="flex flex-col bg-primary-dark px-6 py-8 text-paper sm:px-10 lg:min-h-[900px] lg:px-12 lg:py-16 xl:px-16">
      <div className="flex items-center gap-2" aria-label="Sellio"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-paper text-[22px] font-extrabold text-dark">S</span><span className="text-2xl font-extrabold">Sellio</span></div>
      <div className="mt-6 max-w-md"><h2 className="text-[28px] font-extrabold leading-9">Все заказы Kaspi в одной системе</h2><p className="mt-3 text-base leading-6">Просматривайте импортированные заказы, отчёты и ручные остатки. Импорт охватывает окно в 14 дней, а не всю историю магазина.</p></div>
      <div className="mt-16 hidden text-dark lg:block"><DashboardPreview compact /></div>
      <div className="mt-10 hidden rounded-xl border border-paper/30 p-6 lg:block"><h3 className="font-bold">Сначала подключение. Затем ваши данные.</h3><p className="mt-3 text-sm leading-7">Пример выше построен на синтетических заказах. Для работы с вашим магазином нужны настроенные Supabase, сервер и API-токен Kaspi. Платный выбор не активирует доступ.</p></div>
      <p className="mt-auto hidden pt-8 text-xs lg:block">© 2026 Sellio.</p>
    </aside>
  );
}
