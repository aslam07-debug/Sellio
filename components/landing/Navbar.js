'use client';

import { useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import ActionLink from './ActionLink';

export const navigation = [['Возможности', '/#features'], ['Как это работает', '/#how-it-works'], ['Тарифы', '/pricing']];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="relative z-20 border-b border-warm bg-surface">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-6 py-5">
        <Link href="/" aria-label="Sellio — на главную" className="flex items-center gap-2 text-2xl font-extrabold"><span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-dark text-paper">S</span>Sellio</Link>
        <nav aria-label="Основная навигация" className="hidden items-center gap-7 text-sm font-semibold lg:flex">{navigation.map(([label, href]) => <Link key={href} href={href} className="hover:text-primary-dark">{label}</Link>)}</nav>
        <div className="hidden items-center gap-6 lg:flex"><Link href="/login" className="text-sm font-bold hover:text-primary-dark">Войти</Link><ActionLink href="/register">Создать аккаунт</ActionLink></div>
        <Button variant="ghost" className="lg:hidden" aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>{open ? 'Закрыть' : 'Меню'}</Button>
      </div>
      {open && <nav id="mobile-navigation" aria-label="Мобильная навигация" className="border-t border-warm px-6 pb-6 lg:hidden" onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>{[...navigation, ['Войти', '/login'], ['Создать аккаунт', '/register']].map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)} className="block border-b border-warm py-4 text-sm font-semibold hover:text-primary-dark">{label}</Link>)}</nav>}
    </header>
  );
}
