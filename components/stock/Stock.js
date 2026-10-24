'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/components/shell/AppContext';
import useResource from '@/components/shell/useResource';
import useMutation from '@/components/shell/useMutation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Skeleton from '@/components/ui/Skeleton';
import { money, orderDate } from '@/lib/reportView';
import StockForm from './StockForm';

const units = value => value === null ? 'Нет данных' : `${value.toLocaleString('ru-KZ')} ед.`;
function RowActions({ row, session, storeId, edit, saved }) {
  const mutation = useMutation(session), writable = Boolean(row.updatedAt);
  return <div className="space-y-2"><div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={!writable || mutation.busy} onClick={() => edit('rebase', row)}>Пересчитать</Button><Button variant="ghost" disabled={!writable || mutation.busy} onClick={() => edit('set-price', row)}>Цена</Button><Button variant="ghost" disabled={!writable || row.available === null || mutation.busy} loading={mutation.busy} onClick={() => mutation.run('/api/stock/toggle', { storeId, id: row.id, expectedUpdatedAt: row.updatedAt, available: !row.available }, saved)}>{row.available === true ? 'Выключить' : row.available === false ? 'Включить' : 'Флаг неизвестен'}</Button></div>{!writable && <p className="text-xs text-warning">Нужна корректная версия updated_at; обратитесь к администратору.</p>}{mutation.error && <p role="alert" className="text-xs text-danger">{mutation.error}</p>}</div>;
}
function Balance({ row }) {
  return <div><p className={`font-inter text-lg font-bold ${row.low ? 'text-danger' : 'text-dark'}`}>{units(row.balance)}</p>{row.balance < 0 && row.balance !== null && <p className="text-xs text-danger">Счётчик превышает базу</p>}{row.percent !== null && <progress className="mt-2 h-2 w-full accent-primary" value={row.percent} max="100" aria-label="Доля расчётного остатка от базы" />}<p className="mt-1 text-xs text-muted">База {units(row.base)} · Продано {units(row.sold)}</p></div>;
}
function StockLedger({ session, storeId, store, refresh }) {
  const [q, setQ] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(1), [revision, setRevision] = useState(0), [editor, setEditor] = useState(null), [notice, setNotice] = useState('');
  const query = new URLSearchParams({ storeId, q, filter, page: String(page), pageSize: '20' }).toString();
  const result = useResource('/api/stock', session, query, refresh + revision, Boolean(storeId));
  const reload = () => { setEditor(null); setRevision(v => v + 1); };
  const saved = () => { setNotice('Изменения сохранены только в Sellio.'); reload(); };
  const edit = (action, row) => { setNotice(''); setEditor({ action, row }); };
  const rows = result.data?.data ?? [], meta = result.data?.meta;
  return <>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-primary-dark">Локальный учёт / Kaspi</p><h1 className="mt-2 text-2xl font-extrabold sm:text-3xl">Управление остатками (SKU)</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Ваш ручной базовый остаток минус сохранённый счётчик продаж. Не данные живого склада Kaspi.</p></div><Button disabled={!storeId || Boolean(editor)} onClick={() => edit('add')}>Добавить товар</Button></header>
    <Card className="bg-panel p-4 text-sm leading-6"><strong>Автоматическое списание по заказам ещё не настроено.</strong><p className="text-muted">Импорт заказов не изменяет остатки. Цена, активность и пересчёт действуют только в Sellio; опубликованные карточки Kaspi не меняются.</p></Card>
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {editor && <StockForm key={`${editor.action}:${editor.row?.id}:${editor.row?.updatedAt}`} session={session} storeId={storeId} row={editor.row} action={editor.action} close={() => setEditor(null)} saved={saved} />}
    {meta && <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm"><strong>Низкий расчётный остаток: {meta.lowCount} SKU</strong><p className="mt-1 text-muted">Правило Sellio: остаток ≤ {meta.threshold} локальных ед., включая отрицательные значения. Не норматив Kaspi.{meta.unknownCount > 0 && ` У ${meta.unknownCount} строк остаток неизвестен.`}</p></div>}
    <Card className="overflow-hidden"><div className="grid gap-4 border-b border-warm p-5 sm:grid-cols-[minmax(0,1fr)_220px_auto]"><Input id="stock-search" label="Поиск SKU или названия" value={q} maxLength={100} onChange={e => { setQ(e.target.value); setPage(1); setEditor(null); }} /><label className="text-[13px] font-bold">Показать<select className="mt-1.5 block min-h-11 w-full rounded-lg border border-warm bg-paper px-3 text-sm" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); setEditor(null); }}><option value="all">Все товары</option><option value="active">Активные в Sellio</option><option value="low">Низкий остаток</option></select></label><Button variant="ghost" className="self-end" onClick={reload}>Обновить список</Button></div>
      {result.loading && <div role="status" className="space-y-3 p-5"><p className="text-sm text-muted">Загружаем остатки…</p><Skeleton className="h-40 w-full" /></div>}
      {result.error && <p role="alert" className="p-5 text-sm text-danger">{result.error}</p>}
      {!result.loading && !result.error && !rows.length && <div className="p-8 text-center"><h2 className="font-bold">{storeId ? 'Товары не найдены' : 'Выберите магазин'}</h2><p className="mt-2 text-sm text-muted">Ручной учёт начинается с вашего SKU и измеренного базового остатка. Демо-товары не добавляются.</p></div>}
      {!!rows.length && <><div className="hidden overflow-x-auto lg:block"><table className="w-full text-left text-sm"><thead className="bg-surface text-xs text-muted"><tr>{['SKU / товар', 'Магазин', 'Цена Sellio', 'Активен', 'Расчётный остаток / база / продано', 'Обновлено / действия'].map(label => <th key={label} className="px-4 py-3 font-bold">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-warm"><td className="max-w-64 break-words px-4 py-5"><p className="font-inter font-bold">{row.sku ?? 'SKU неизвестен'}</p><p className="mt-1 text-muted">{row.model ?? 'Название неизвестно'}</p></td><td className="px-4 py-5">{store?.name}</td><td className="whitespace-nowrap px-4 py-5 font-inter">{money(row.price)}</td><td className="px-4 py-5">{row.available === null ? 'Неизвестно' : row.available ? 'Да' : 'Нет'}</td><td className="min-w-52 px-4 py-5"><Balance row={row} /></td><td className="min-w-72 px-4 py-5"><p className="mb-3 font-inter text-xs text-muted">{orderDate(row.updatedAt ? Date.parse(row.updatedAt) : null)} · Алматы</p><RowActions key={row.updatedAt} row={row} session={session} storeId={storeId} edit={edit} saved={saved} /></td></tr>)}</tbody></table></div>
      <div className="divide-y divide-warm lg:hidden">{rows.map(row => <article key={row.id} className="space-y-4 p-5"><div className="flex justify-between gap-4"><div className="min-w-0"><p className="break-words font-bold">{row.model ?? 'Название неизвестно'}</p><p className="mt-1 break-words font-inter text-xs text-muted">SKU {row.sku ?? 'Неизвестен'} · {store?.name}</p></div><span className="shrink-0 font-inter font-bold">{money(row.price)}</span></div><Balance row={row} /><p className="text-xs text-muted">Активен в Sellio: {row.available === null ? 'Неизвестно' : row.available ? 'Да' : 'Нет'}<br />{orderDate(row.updatedAt ? Date.parse(row.updatedAt) : null)} · Алматы</p><RowActions key={row.updatedAt} row={row} session={session} storeId={storeId} edit={edit} saved={saved} /></article>)}</div></>}
      {meta && <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-warm p-5 text-sm"><span className="text-muted">Найдено {meta.total} SKU · Страница {page} / {meta.totalPages || 1}</span><div className="flex gap-2"><Button variant="ghost" disabled={page <= 1 || result.loading} onClick={() => { setPage(v => v - 1); setEditor(null); }}>Назад</Button><Button variant="ghost" disabled={page >= meta.totalPages || result.loading} onClick={() => { setPage(v => v + 1); setEditor(null); }}>Далее</Button></div></footer>}
    </Card>
    <Card className="flex flex-wrap items-center justify-between gap-4 p-5"><div><h2 className="font-bold">Уведомления Telegram</h2><p className="mt-1 text-sm text-muted">Не настроены. Бот и фоновая проверка остатков пока недоступны.</p></div><Link href="/settings" className="text-sm font-bold text-primary-dark underline">Настройки интеграций</Link></Card>
  </>;
}
export default function Stock() {
  const { session, storeId, stores, refresh } = useApp();
  return <StockLedger key={`${session.user.id}:${session.access_token}:${storeId}`} session={session} storeId={storeId} store={stores.find(s => s.id === storeId)} refresh={refresh} />;
}
