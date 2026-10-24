'use client';
import Link from 'next/link';
import useReport from '@/components/shell/useReport';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Skeleton from '@/components/ui/Skeleton';
import KpiChips from './KpiChips';
import FinancialCards from './FinancialCards';
import RevenueChart from './RevenueChart';
import StatusDonut from './StatusDonut';
import CityHistogram from './CityHistogram';
import TopSkuTable from './TopSkuTable';
import ActivityFeed from './ActivityFeed';
import { money } from '@/lib/reportView';

export default function Dashboard() {
  const { data, loading, error } = useReport(['/api/dashboard/summary', '/api/dashboard/cities', '/api/dashboard/top-sku', '/api/dashboard/revenue-by-day']);
  const summary = data?.[0].data;
  return <>
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-primary-dark">Рабочее пространство</p><h1 className="mt-2 text-2xl font-extrabold sm:text-3xl">Dashboard</h1><p className="mt-2 text-sm text-muted">Обзор заказов вашего магазина</p></div><div className="flex gap-2"><Button variant="ghost" disabled aria-pressed>Kaspi</Button>{['Ozon', 'WB'].map(m => <Button key={m} variant="icon" disabled title="После запуска">{m}</Button>)}</div></header>
    <p className="rounded-lg border border-warm bg-panel p-3 text-xs leading-5 text-muted">{summary?.coverage ?? 'По импортированным заказам. Импорт: последние 14 дней, не полная история.'} Сравнение периодов недоступно без подтверждённого покрытия.</p>
    {error && <p role="alert" className="rounded-lg bg-danger/5 p-4 text-sm text-danger">{error}</p>}
    {loading ? <div role="status" className="grid gap-4 sm:grid-cols-2"><span className="sr-only">Загрузка аналитики</span>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40 w-full" />)}</div> : <>
      <KpiChips summary={summary} /><FinancialCards data={summary?.financial} />
      {summary?.warnings.map(w => <p key={w} className="text-xs text-warning">{w}</p>)}
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(220px,1fr)_minmax(200px,1fr)]"><RevenueChart data={data?.[3].data} /><StatusDonut count={summary?.count} total={summary?.total} /><Card className="p-5"><h2 className="font-bold">Экспресс-показатели</h2><p className="mt-2 text-xs leading-5 text-muted">Доли наблюдаемых заказов текущего периода, не сравнение с историей.</p><dl className="mt-5 space-y-5 text-xs">{[['Отменены', summary?.quickMetrics.cancelledPercent], ['Возвраты', summary?.quickMetrics.returnedPercent], ['С комментарием', summary?.quickMetrics.commentPercent]].map(([label, value]) => <div key={label} className="flex justify-between gap-2"><dt>{label}</dt><dd className="font-inter font-bold">{value === null || value === undefined ? 'Нет данных' : `${value.toFixed(1)}%`}</dd></div>)}<div><dt>Расходы продавца на доставку</dt><dd className="mt-2 font-inter font-bold">{money(summary?.quickMetrics.sellerDelivery.value)}</dd><p className="mt-2 leading-5 text-muted">Не комиссия. Нет суммы у {summary?.quickMetrics.sellerDelivery.missing ?? '—'} заказов.</p></div></dl></Card></div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2"><CityHistogram data={data?.[1].data} /><TopSkuTable data={data?.[2].data} /></div>
      <div className="grid gap-4 sm:grid-cols-2">{[['Доставка', summary?.deliveries], ['Оплата', summary?.payments]].map(([label, values]) => <Card key={label} className="p-5"><h2 className="font-bold">{label}</h2><dl className="mt-4 space-y-3 text-sm">{values?.map(v => <div key={v.label} className="flex justify-between gap-3"><dt>{v.label}</dt><dd className="font-inter">{v.value} · {v.percent.toFixed(1)}%</dd></div>)}</dl>{!values?.length && <p className="mt-4 text-sm text-muted">Нет данных</p>}</Card>)}</div>
      <details className="rounded-xl border border-warm bg-paper p-5"><summary className="cursor-pointer font-bold">Подробности по часам (Asia/Almaty)</summary><div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-8">{summary?.hours.map(h => <p key={h.hour} className="rounded-lg bg-panel p-3 text-xs">{h.hour}:00<span className="mt-2 block font-inter font-bold">{h.orders}</span></p>)}</div><p className="mt-4 text-xs text-muted">Дневная статистика показана на графике. Часы рассчитаны по созданию заказов, не по времени импорта.</p></details>
      <div className="grid gap-4 xl:grid-cols-2"><ActivityFeed data={summary?.recent} /><Card className="p-5"><h2 className="font-bold">Правила цен и остатки</h2><p className="mt-3 text-sm leading-6 text-muted">Нет исходных остатков, себестоимости или API правил цен. Заказанные количества не являются складскими остатками.</p><Button disabled variant="ghost" className="mt-4" title="Будущий этап разработки">Настроить правила — недоступно</Button><Link href="/orders" className="mt-6 block text-sm font-bold text-primary-dark underline">Открыть все заказы</Link></Card></div>
    </>}
  </>;
}
