'use client';

import { useState } from 'react';
import DashboardPreview from './DashboardPreview';
import ActionLink from './ActionLink';
import { demoCities, statuses, summarizeDemo } from './model';

export default function Demo() {
  const [status, setStatus] = useState('all');
  const [city, setCity] = useState('all');
  return <section id="demo" className="scroll-mt-6 border-y border-warm bg-primary-light"><div className="mx-auto max-w-[1200px] px-6 py-16 sm:py-20"><div className="mb-8 max-w-2xl"><p className="text-xs font-bold uppercase tracking-wider text-primary-dark">Попробуйте прямо здесь</p><h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">Не видео. Небольшое рабочее демо.</h2><p className="mt-4 leading-7 text-muted">Измените статус или город: список и показатели пересчитаются. Только локальные синтетические данные, без подключения к вашему аккаунту.</p></div><div className="mb-5 flex flex-wrap gap-5">{[['demo-status', 'Статус', status, setStatus, Object.entries(statuses)], ['demo-city', 'Город', city, setCity, demoCities.map((name) => [name, name === 'all' ? 'Все города' : name])]].map(([id, label, value, update, options]) => <label key={id} htmlFor={id} className="text-sm font-bold">{label}<select id={id} value={value} onChange={(event) => update(event.target.value)} className="mt-2 block min-h-11 w-full min-w-44 rounded-lg border border-warm bg-paper px-3 py-2 font-normal">{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>)}</div><div aria-live="polite" aria-atomic="true"><p className="sr-only">В выборке {summarizeDemo(status, city).count} заказов</p></div><DashboardPreview summary={summarizeDemo(status, city)} /><div className="mt-7 flex flex-wrap items-center gap-4"><ActionLink href="/register">Попробовать на своих данных</ActionLink><p className="text-xs text-muted">После настройки сервера, подключения Kaspi и импорта.</p></div></div></section>;
}
