'use client';

import { useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { features } from './model';
import DashboardPreview from './DashboardPreview';
import Card from '@/components/ui/Card';

export default function Features() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef(null);
  const feature = features[selected];
  const keyboard = (event) => {
    const positions = { ArrowRight: (selected + 1) % features.length, ArrowLeft: (selected + features.length - 1) % features.length, Home: 0, End: features.length - 1 };
    if (positions[event.key] === undefined) return;
    event.preventDefault();
    setSelected(positions[event.key]);
    tabs.current?.querySelectorAll('[role="tab"]')[positions[event.key]]?.focus();
  };
  return <section id="features" className="scroll-mt-6 bg-panel"><div className="mx-auto max-w-[1200px] px-6 py-16 sm:py-20"><p className="text-xs font-bold uppercase tracking-wider text-primary-dark">Возможности / текущий MVP</p><h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">Один кабинет.<br />Несколько точек зрения.</h2><div ref={tabs} role="tablist" aria-label="Возможности Sellio" className="mt-8 flex flex-wrap gap-2" onKeyDown={keyboard}>{features.map((item, index) => <Button key={item.id} variant={selected === index ? 'primary' : 'ghost'} role="tab" id={`feature-tab-${item.id}`} aria-controls={`feature-panel-${item.id}`} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)}>{item.name}</Button>)}</div>{features.map((item) => <div key={item.id} role="tabpanel" id={`feature-panel-${item.id}`} aria-labelledby={`feature-tab-${item.id}`} hidden={feature.id !== item.id} tabIndex={0}>{feature.id === item.id && <div className="mt-10 grid items-center gap-10 lg:grid-cols-2"><div><h3 className="text-2xl font-extrabold">{feature.title}</h3><p className="mt-4 leading-7 text-muted">{feature.description}</p><ul className="mt-6 space-y-3">{feature.points.map((point) => <li key={point} className="flex gap-3 text-sm"><span aria-hidden="true" className="text-primary-dark">+</span>{point}</li>)}</ul></div>{feature.id === 'stock' ? <Card className="p-6"><p className="text-xs text-muted">Синтетический пример ручного учёта</p><h4 className="mt-5 font-bold">Лампа / собственный SKU DEMO-LAMP</h4><dl className="mt-6 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-muted">Базовый остаток</dt><dd className="mt-2 font-inter text-3xl font-bold">12</dd></div><div><dt className="text-muted">Локальная цена</dt><dd className="mt-2 font-inter text-3xl font-bold">18 000 ₸</dd></div></dl><p className="mt-6 text-xs leading-5 text-muted">Демонстрация, не склад Kaspi. Импорт не изменяет остаток.</p></Card> : <DashboardPreview compact />}</div>}</div>)}<div className="mt-10 flex flex-wrap gap-3 border-t border-warm pt-6" aria-label="Планируемые возможности">{['Telegram', 'Ценовые правила', 'Накладные'].map((name) => <Button key={name} variant="ghost" disabled>{name} · планируется</Button>)}</div><p className="mt-3 text-xs text-muted">Сроки выпуска не подтверждены. Эти функции сейчас недоступны.</p></div></section>;
}
