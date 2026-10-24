'use client';
import { useEffect, useRef, useState } from 'react';
import useReport from '@/components/shell/useReport';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Skeleton from '@/components/ui/Skeleton';
import { createRequestGate, orderDate, money, statuses, deliveryLabel, paymentLabel } from '@/lib/reportView';
import CommentEditor from './CommentEditor';

const selectClass = 'mt-1 min-h-11 w-full rounded-lg border border-warm bg-paper px-3 text-sm';
export default function Orders() {
  const [q, setQ] = useState(''), [status, setStatus] = useState(''), [city, setCity] = useState(''), [page, setPage] = useState(1);
  const filters = new URLSearchParams({ q, status, city, page: String(page), pageSize: '20' }).toString();
  const { data, loading, error, query, session, storeId, period, refresh } = useReport(['/api/kaspi/orders'], filters);
  const result = data?.[0], rows = result?.data ?? [], meta = result?.meta;
  const exportGate = useRef(createRequestGate());
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState('');
  const scope = `${session?.user?.id}:${session?.access_token}:${storeId}:${query}:${filters}:${refresh}`;
  useEffect(() => { exportGate.current.cancel(); setExporting(false); setExportError(''); return () => exportGate.current.cancel(); }, [scope]);
  useEffect(() => { setPage(1); }, [storeId, period.start, period.end]);
  const exportCsv = async () => {
    if (exporting || !storeId) return;
    const request = exportGate.current.begin(); setExporting(true); setExportError('');
    try {
      const parameters = new URLSearchParams(`${query}&${filters}`); parameters.set('format', 'csv');
      const response = await fetch(`/api/kaspi/orders?${parameters}`, { signal: request.signal, cache: 'no-store', headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!response.ok) { const payload = await response.json(); throw Error(payload.error); }
      const blob = await response.blob(); if (!request.current()) return;
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      try { a.href = url; a.download = 'sellio-orders.csv'; document.body.appendChild(a); a.click(); }
      finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (issue) { if (request.current()) setExportError(issue.message || 'Не удалось экспортировать.'); }
    finally { if (request.current()) setExporting(false); }
  };
  const products = order => <ul className="space-y-2">{order.entries.map((e, i) => <li key={e.id ?? i} className="max-w-64 break-words"><p>{e.name ?? 'Название не получено'}</p><p className="text-xs text-muted">{e.code ? `Предложение: ${e.code}` : e.catalogId ? `Каталог: ${e.catalogId}` : 'Код не получен'}</p><p className="mt-1 text-xs">{e.quantity ?? 'Нет данных'} {e.unit === 'PIECES' ? 'шт.' : e.unit === 'WEIGHT_VOLUME' ? 'вес / объём' : '(ед. неизвестна)'}</p></li>)}{!order.entries.length && <li>Позиции не получены</li>}</ul>;
  const badge = order => <span className={`inline-block rounded-full px-3 py-1 text-xs ${order.bucket === 'completed' ? 'bg-success/10 text-success' : order.bucket === 'cancelled' ? 'bg-danger/10 text-danger' : 'bg-primary-light text-primary-dark'}`}>{statuses[order.bucket]}{order.bucket === 'unknown' && order.status ? ` (${order.status})` : ''}</span>;
  const comment = order => <CommentEditor key={`${scope}:${order.id}:${order.updatedAt}`} order={order} query={query} token={session.access_token} />;
  return <>
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-extrabold sm:text-3xl">Заказы маркетплейсов</h1><p className="mt-2 text-sm text-muted">Kaspi: импортированные заказы, без изменения статусов</p></div><Button variant="ghost" onClick={exportCsv} loading={exporting} disabled={!storeId || loading}>Экспорт CSV</Button></header>
    <p className="rounded-lg bg-panel p-3 text-xs leading-5 text-muted">По импортированным заказам. Импорт ограничен последними 14 днями. CSV содержит весь отфильтрованный набор, не только страницу. CSV и Excel (.xlsx) с историей доступны на странице «Экспорт». Изменение статусов не реализовано.</p>
    <Card className="grid gap-3 p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"><Input id="order-search" label="Поиск по номеру или товару" placeholder="Номер, название или код" maxLength={100} value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /><label className="text-xs font-bold">Статус<select className={selectClass} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Все статусы</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs font-bold">Город<select className={selectClass} value={city} onChange={e => { setCity(e.target.value); setPage(1); }}><option value="">Все города</option>{[...new Set([city, ...(meta?.cities ?? [])])].filter(Boolean).map(c => <option key={c}>{c}</option>)}</select></label></Card>
    {(error || exportError) && <p role="alert" className="rounded-lg bg-danger/5 p-4 text-sm text-danger">{error || exportError}</p>}
    {loading ? <div role="status" className="space-y-3"><span className="sr-only">Загрузка заказов</span>{[0, 1, 2].map(i => <Skeleton key={i} className="h-28 w-full" />)}</div> : <>
      <p className="text-sm text-muted">Найдено: <span className="font-inter font-bold text-dark">{meta?.total ?? 0}</span></p>
      {meta?.warnings.map(w => <p key={w} className="text-xs text-warning">{w}</p>)}
      {!rows.length ? <Card className="p-8 text-center"><h2 className="font-bold">{meta?.total ? 'На этой странице нет заказов' : 'Заказов не найдено'}</h2><p className="mt-2 text-sm text-muted">Измените фильтры, период или импортируйте заказы через подключение Kaspi.</p></Card> : <>
        <Card className="hidden min-w-0 overflow-hidden lg:block"><div className="overflow-x-auto"><table className="w-full text-left font-inter text-xs"><thead className="bg-panel text-muted"><tr>{['Номер / дата / время', 'Город', 'Товары / количество', 'Сумма', 'Доставка / оплата', 'Статус', 'Комментарий'].map(label => <th key={label} className="px-4 py-4 font-medium">{label}</th>)}</tr></thead><tbody>{rows.map(o => <tr key={o.id} className="border-t border-warm align-top"><td className="max-w-44 break-words px-4 py-5"><strong>№ {o.code}</strong><p className="mt-2 text-muted">{orderDate(o.creationDate)}</p></td><td className="px-4 py-5">{o.city}</td><td className="px-4 py-5">{products(o)}</td><td className="whitespace-nowrap px-4 py-5">{money(o.totalPrice)}</td><td className="px-4 py-5">{deliveryLabel(o)}<p className="mt-2 text-muted">{paymentLabel(o.paymentMode)}</p></td><td className="px-4 py-5">{badge(o)}</td><td className="px-4 py-5">{comment(o)}</td></tr>)}</tbody></table></div></Card>
        <div className="space-y-3 lg:hidden">{rows.map(o => <Card key={o.id} className="space-y-4 p-4"><div className="flex flex-wrap justify-between gap-2"><h2 className="break-all font-inter font-bold">№ {o.code}</h2>{badge(o)}</div><p className="font-inter text-xs text-muted">{orderDate(o.creationDate)} · {o.city}</p><div className="text-sm">{products(o)}</div><div className="flex flex-wrap justify-between gap-2 text-sm"><span>{deliveryLabel(o)}<span className="block text-xs text-muted">{paymentLabel(o.paymentMode)}</span></span><strong className="font-inter">{money(o.totalPrice)}</strong></div>{comment(o)}</Card>)}</div>
      </>}
      <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted"><p>Страница {meta?.page ?? page} из {meta?.totalPages ?? 0} · по 20 заказов</p><div className="flex gap-2"><Button variant="ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Назад</Button><Button variant="ghost" onClick={() => setPage(p => p + 1)} disabled={!meta || page >= meta.totalPages}>Далее</Button></div></footer>
    </>}
  </>;
}
