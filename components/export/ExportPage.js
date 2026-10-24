'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/shell/AppContext';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Skeleton from '@/components/ui/Skeleton';
import { createRequestGate, statuses } from '@/lib/reportView';
import { exportContextKey, exportLabels, exportPreset } from '@/lib/exportView';

const control = 'mt-2 w-full rounded-lg border border-warm bg-paper px-3 py-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary';
const explanations = {
  orders: 'Импортированные заказы, статус, город, сумма и доставка. Без данных покупателя и полного адреса.',
  finance: 'Только суммы завершённых заказов и известная стоимость доставки продавца. Это не выплаты Kaspi. Комиссия и чистая прибыль недоступны.',
  products: 'Наблюдаемые позиции и коды предложений/каталога, не подтверждённые seller SKU и не складские остатки. Единицы не смешиваются.'
};
export default function ExportPage() {
  const { session, storeId, stores, period, setPeriod, refresh } = useApp();
  const [filters, setFilters] = useState({ scope: 'current', status: '', city: '', q: '', group: 'day', sort: 'amount' });
  const [notice, setNotice] = useState(null), [busy, setBusy] = useState(''), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [history, setHistory] = useState({ key: '', loading: true, data: [], meta: null, error: '' });
  const downloadGate = useRef(createRequestGate()), historyGate = useRef(createRequestGate()), busyRef = useRef(false);
  const key = exportContextKey(session, storeId, period, filters), identity = useRef(key); identity.current = key;
  const change = (name, value) => setFilters(current => ({ ...current, [name]: value }));
  const historyKey = JSON.stringify([key, page, revision, refresh]);
  useEffect(() => {
    downloadGate.current.cancel(); busyRef.current = false; setBusy(''); setNotice(null); setPage(1);
    return () => { downloadGate.current.cancel(); busyRef.current = false; };
  }, [key]);
  useEffect(() => {
    const request = historyGate.current.begin(), context = key;
    setHistory({ key: historyKey, loading: true, data: [], meta: null, error: '' });
    const load = async () => {
      try {
        const response = await fetch(`/api/exports/history?page=${page}`, { signal: request.signal, cache: 'no-store', headers: { Authorization: `Bearer ${session.access_token}` } });
        const payload = await response.json();
        if (!request.current() || identity.current !== context) return;
        if (!response.ok) throw Error(payload.error || 'Не удалось прочитать историю.');
        setHistory({ key: historyKey, loading: false, data: payload.data, meta: payload.meta, error: '' });
      } catch (error) { if (request.current() && identity.current === context) setHistory({ key: historyKey, loading: false, data: [], meta: null, error: error.message || 'Не удалось прочитать историю.' }); }
    };
    load(); return () => historyGate.current.cancel();
  }, [historyKey, session.access_token]);
  useEffect(() => () => { identity.current = null; downloadGate.current.cancel(); historyGate.current.cancel(); }, []);
  const download = async (report, format, saved) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const request = downloadGate.current.begin(), context = key;
    const current = () => request.current() && identity.current === context;
    setBusy(saved ? `history:${saved.id}` : `${report}:${format}`); setNotice(null);
    const descriptor = saved?.descriptor ?? { version: 1, report, format, storeIds: filters.scope === 'all' ? stores.map(s => s.id) : [storeId], ...period, status: filters.status, city: filters.city, q: filters.q, group: filters.group, sort: filters.sort };
    try {
      const response = await fetch(saved ? `/api/exports/${encodeURIComponent(saved.id)}/regenerate` : '/api/exports', { method: 'POST', signal: request.signal, cache: 'no-store', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(saved ? {} : descriptor) });
      if (!response.ok) { const payload = await response.json(); throw Error(payload.error || 'Не удалось сформировать файл.'); }
      const blob = await response.blob();
      if (!current()) return;
      if (response.headers.get('X-Sellio-History-Saved') !== '1') throw Error('Не удалось подтвердить сохранение истории. Повторите запрос.');
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      try {
        link.href = url; link.download = `sellio-${descriptor.report}-${descriptor.start}-${descriptor.end}.${descriptor.format}`;
        document.body.appendChild(link); link.click();
      } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setNotice({ key: context, text: `Файл сформирован. Заказов: ${response.headers.get('X-Sellio-Order-Count') ?? '—'}, строк отчёта: ${response.headers.get('X-Sellio-Row-Count') ?? '—'}. Загрузка запрошена в браузере; сохранение на диск не подтверждается.`, error: false });
      setPage(1); setRevision(v => v + 1);
    } catch (error) { if (current()) setNotice({ key: context, text: error.message || 'Не удалось сформировать экспорт.', error: true }); }
    finally { if (current()) { busyRef.current = false; setBusy(''); } }
  };
  const visibleHistory = history.key === historyKey ? history : { loading: true, data: [], meta: null, error: '' };
  const ready = Boolean(storeId && stores.length && !(filters.scope === 'all' && stores.length > 10));
  return <div className="mx-auto max-w-[720px] space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-wider text-primary-dark">Данные вашего Kaspi</p><h1 className="mt-2 text-2xl font-extrabold sm:text-3xl">Экспорт отчётов</h1><p className="mt-3 text-sm leading-6 text-muted">Сформируйте CSV или Excel (.xlsx) по импортированным данным. История хранит параметры, а не архив файлов.</p></header>
    <Card className="p-5 sm:p-6"><h2 className="font-bold">Фильтры для трёх отчётов</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-semibold">Магазин<select className={control} value={filters.scope} onChange={e => change('scope', e.target.value)}><option value="current">Выбранный в шапке: {stores.find(s => s.id === storeId)?.name ?? 'не выбран'}</option><option value="all" disabled={!stores.length || stores.length > 10}>Все мои магазины Kaspi ({stores.length})</option></select></label>
      <label className="text-sm font-semibold">Быстрый период<select className={control} value="custom" onChange={e => { const next = exportPreset(e.target.value); if (next) setPeriod(next); }}><option value="custom">Выбранные даты</option><option value="last14">Последние 14 дней</option><option value="month">Этот месяц до сегодня</option><option value="previous">Предыдущий месяц</option><option disabled>90 дней: недоступно (лимит 31 день)</option></select></label>
      <Input id="export-start" label="Начало периода" type="date" value={period.start} onChange={e => setPeriod({ ...period, start: e.target.value })} />
      <Input id="export-end" label="Конец периода включительно" type="date" value={period.end} onChange={e => setPeriod({ ...period, end: e.target.value })} />
      <label className="text-sm font-semibold">Статус<select className={control} value={filters.status} onChange={e => change('status', e.target.value)}><option value="">Все статусы</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <Input id="export-city" label="Город (точное название)" value={filters.city} maxLength={200} onChange={e => change('city', e.target.value)} />
      <div className="sm:col-span-2"><Input id="export-search" label="Номер заказа, название или наблюдаемый код товара" value={filters.q} maxLength={100} onChange={e => change('q', e.target.value)} /></div>
    </div><p className="mt-4 text-xs leading-5 text-muted">Asia/Almaty, от 1 до 31 календарного дня. До 10 магазинов и 10 000 сохранённых заказов суммарно, без частичных файлов. Импорт ограничен последними 14 днями; выбранный период не гарантирует полноту истории. Ozon и WB недоступны.</p></Card>
    {notice?.key === key && <div role={notice.error ? 'alert' : 'status'} className={`rounded-lg border p-4 text-sm leading-6 ${notice.error ? 'border-danger/30 bg-danger/5 text-danger' : 'border-warm bg-panel text-muted'}`}>{notice.text}</div>}
    {Object.entries(exportLabels).map(([report, title], index) => <Card key={report} className="p-5 sm:p-6"><div className="flex items-start gap-4"><span className="rounded-lg bg-primary-light px-3 py-2 font-inter text-sm font-bold text-primary-dark">0{index + 1}</span><div><h2 className="text-lg font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted">{explanations[report]}</p></div></div>
      {report === 'finance' && <label className="mt-5 block text-sm font-semibold">Группировка<select className={control} value={filters.group} onChange={e => change('group', e.target.value)}><option value="day">По дням</option><option value="week">По неделям (понедельник)</option><option value="month">По месяцам</option></select></label>}
      {report === 'products' && <label className="mt-5 block text-sm font-semibold">Сортировка<select className={control} value={filters.sort} onChange={e => change('sort', e.target.value)}><option value="amount">По известной полной сумме позиций</option><option value="quantity">По количеству (единицы различаются)</option><option value="name">По названию</option></select></label>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{['csv', 'xlsx'].map(format => <Button key={format} onClick={() => download(report, format)} disabled={!ready || Boolean(busy)} loading={busy === `${report}:${format}`}>{format === 'csv' ? 'Скачать CSV' : 'Скачать Excel (.xlsx)'}</Button>)}</div>
    </Card>)}
    <Card className="p-5 sm:p-6"><h2 className="font-bold">Другие способы</h2><p className="mt-2 text-sm leading-6 text-muted">Email, Google Sheets и PDF не реализованы. Нет отправки писем, очереди или подключённых получателей.</p><div className="mt-4 flex flex-wrap gap-2">{['Email', 'Google Sheets', 'PDF'].map(label => <Button key={label} disabled variant="ghost" title="Интеграция не реализована">{label}</Button>)}</div></Card>
    <section aria-labelledby="history-title"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="history-title" className="text-xl font-bold">История экспорта</h2><Button variant="ghost" disabled={visibleHistory.loading || Boolean(busy)} onClick={() => setRevision(v => v + 1)}>Обновить</Button></div><p className="mt-3 text-xs leading-5 text-muted">Записи об успешном формировании, не о сохранении файла на диск. «Сформировать заново» использует те же параметры и текущие импортированные данные: результат может измениться. При недоступной истории файл не выдаётся.</p>
      {visibleHistory.loading ? <div className="mt-4" role="status"><p className="text-sm text-muted">Читаем историю…</p><Skeleton className="mt-3 h-32 w-full" /></div> : visibleHistory.error ? <div className="mt-4 text-sm text-danger" role="alert">{visibleHistory.error}<Button className="mt-3" variant="ghost" onClick={() => setRevision(v => v + 1)}>Повторить</Button></div> : <>
        {!visibleHistory.data.length ? <Card className="mt-4 p-6 text-sm text-muted">В этой странице истории нет записей. Сформируйте отчёт или выберите другую страницу.</Card> : <div className="mt-4 overflow-x-auto rounded-xl border border-warm bg-paper"><table className="w-full text-left text-xs"><thead className="bg-panel text-muted"><tr>{['Дата Asia/Almaty', 'Тип / период', 'Кто сформировал', 'Формат', 'Действие'].map(label => <th key={label} className="px-3 py-4 font-semibold">{label}</th>)}</tr></thead><tbody>{visibleHistory.data.map(row => <tr key={row.id} className="border-t border-warm"><td className="px-3 py-4 font-inter">{row.createdAt ? new Intl.DateTimeFormat('ru-KZ', { timeZone: 'Asia/Almaty', dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.createdAt)) : 'Дата неизвестна'}</td><td className="px-3 py-4">{exportLabels[row.type] ?? 'Старая запись'}<p className="mt-1 text-muted">{row.descriptor ? `${row.descriptor.start} — ${row.descriptor.end}` : 'Параметры не распознаны'}</p></td><td className="px-3 py-4">{row.author}</td><td className="px-3 py-4 font-inter">{row.descriptor?.format.toUpperCase() ?? 'Неизвестен'}</td><td className="px-3 py-4"><Button variant="ghost" className="text-xs" disabled={!row.regenerable || Boolean(busy)} loading={busy === `history:${row.id}`} title={!row.regenerable ? 'Старая или повреждённая запись: создайте новый отчёт' : undefined} onClick={() => download(row.type, row.descriptor.format, row)}>Сформировать заново</Button></td></tr>)}</tbody></table></div>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted">Всего записей: {visibleHistory.meta?.total ?? 0}. Страница {page} из {Math.max(1, visibleHistory.meta?.totalPages ?? 0)}</p><div className="flex gap-2"><Button variant="ghost" disabled={page <= 1 || Boolean(busy)} onClick={() => setPage(v => v - 1)}>Назад</Button><Button variant="ghost" disabled={page >= (visibleHistory.meta?.totalPages ?? 0) || Boolean(busy)} onClick={() => setPage(v => v + 1)}>Далее</Button></div></div>
      </>}
    </section>
  </div>;
}
