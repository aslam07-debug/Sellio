'use client';

import { useState } from 'react';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import ActionLink from './ActionLink';
import { estimateRoutine, number, money } from './model';

export default function Calculator() {
  const [hours, setHours] = useState('5');
  const [rate, setRate] = useState('2000');
  const result = estimateRoutine(hours, rate);
  return <section className="bg-panel"><div className="mx-auto grid max-w-[1200px] gap-10 px-6 py-16 sm:py-20 lg:grid-cols-2"><div><p className="text-xs font-bold uppercase tracking-wider text-primary-dark">Посчитайте свою рутину</p><h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">Сколько времени<br />уходит на учёт?</h2><p className="mt-5 leading-7 text-muted">Оцените объём текущей ручной работы. Это стоимость вашего времени, не дополнительная прибыль и не гарантированная экономия от Sellio.</p><div className="mt-7 grid gap-5 sm:grid-cols-2"><Input id="routine-hours" label="Часов в неделю" type="number" min="0" max="168" step="any" value={hours} onChange={(event) => setHours(event.target.value)} hint="От 0 до 168" /><Input id="routine-rate" label="Стоимость вашего часа, ₸" type="number" min="0" max="1000000" step="any" value={rate} onChange={(event) => setRate(event.target.value)} hint="От 0 до 1 000 000; можно оставить 0" /></div><p className="mt-5 text-xs leading-6 text-muted">Допущение: 52 недели в году. Часы в месяц = часы в неделю × 52 ÷ 12. Часы в год = часы в неделю × 52. Оценка стоимости = часы в год × стоимость часа.</p></div><Card className="flex flex-col justify-center p-7 sm:p-10"><div aria-live="polite" aria-atomic="true">{result ? <><p className="text-sm text-muted">Ваша текущая ручная работа</p><p className="mt-3 font-inter text-5xl font-bold text-primary-dark">{number(result.annual)} <span className="text-lg">ч / год</span></p><p className="mt-3 font-inter text-lg">{number(result.monthly)} ч / месяц</p><p className="mt-7 text-sm text-muted">Оценка стоимости времени за год</p><p className="mt-2 break-words font-inter text-3xl font-bold">{money(result.annualValue)}</p></> : <p role="status" className="text-sm leading-6 text-danger">Введите конечные неотрицательные числа в указанных пределах. Пустые поля не участвуют в расчёте.</p>}</div><p className="mt-6 text-xs leading-6 text-muted">Никакой процент сокращения времени не предполагается. Фактический результат зависит от вашего процесса.</p><ActionLink href="/register" className="mt-6">Изучить Sellio на своих данных</ActionLink></Card></div></section>;
}
