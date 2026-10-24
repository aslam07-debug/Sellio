'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Button from '@/components/ui/Button';

export default function Sidebar({ user, profile, menu, close, logout }) {
  const pathname = usePathname();
  const links = [['/dashboard', 'Обзор'], ['/orders', 'Заказы'], ['/stock', 'Остатки'], ['/export', 'Экспорт'], ['/settings', 'Настройки'], ['/onboarding', 'Подключение Kaspi']];
  return <>
    <aside className={`${menu ? 'fixed inset-0 z-40 flex' : 'hidden'} flex-col border-r border-warm bg-panel p-5 lg:sticky lg:top-0 lg:flex lg:h-screen`}>
      <div className="flex items-center justify-between"><Link href="/dashboard" onClick={close} className="flex items-center gap-2 text-2xl font-extrabold"><span className="rounded-lg bg-primary px-3 py-1 text-paper">S</span>Sellio</Link><Button variant="icon" className="lg:hidden" onClick={close} aria-label="Закрыть меню">×</Button></div>
      <p className="mt-9 text-[10px] font-bold uppercase tracking-widest text-light">Рабочее пространство</p>
      <nav aria-label="Основная навигация" className="mt-3 space-y-2">{links.map(([href, label]) => <Link key={href} href={href} onClick={close} aria-current={pathname === href ? 'page' : undefined} className={`block rounded-lg px-3 py-3 text-sm font-bold ${pathname === href ? 'bg-primary-light text-primary-dark' : 'text-muted hover:bg-warm'}`}>{label}</Link>)}
        {['Прайс-демпфер', 'Накладные', 'Поддержка'].map(label => <Button key={label} variant="icon" disabled title="Будущий этап: функция не реализована" className="w-full justify-start px-3">{label}</Button>)}
      </nav>
      <div className="mt-auto pt-8"><p className="break-words text-sm font-bold">{profile?.name || user.user_metadata?.name || user.user_metadata?.store_name || 'Ваш аккаунт'}</p><p className="mt-1 text-xs text-muted">Kaspi • локальные данные Sellio</p><Button variant="ghost" className="mt-4 w-full" onClick={logout}>Выйти</Button></div>
    </aside>
    <nav aria-label="Мобильная навигация" className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-warm bg-paper p-2 lg:hidden">{links.slice(0, 5).map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined} className={`rounded-lg px-2 py-3 text-xs font-bold ${pathname === href ? 'bg-primary-light text-primary-dark' : 'text-muted'}`}>{label}</Link>)}</nav>
  </>;
}
