'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Skeleton from '@/components/ui/Skeleton';
import { recoveryGate, supabase } from '@/lib/supabase';
import { getAuthErrorMessage } from '@/lib/utils';

const steps = ['Маркетплейс', 'API кабинет', 'Импорт заказов', 'Готово'];
const headings = ['Выбери маркетплейсы', 'Подключи API кабинеты', 'Загружаем ваши данные', 'Ваш кабинет Sellio готов!'];
const money = (value) => new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 2 }).format(value);

export default function OnboardingWizard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(true);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [store, setStore] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(true);
  const alive = useRef(false);
  const pending = useRef(false);
  const pause = useRef(true);
  const controller = useRef(null);
  const title = useRef(null);
  const scope = useRef(null);

  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      controller.current?.abort();
      pause.current = true;
      setToken(''); setStore(null); setCursor(null); setSummary(null); setUser(null);
      scope.current = null;
      router.replace('/login');
    };
    if (!supabase) { setChecking(false); return () => { alive.current = false; }; }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive.current) return;
      if (event === 'PASSWORD_RECOVERY') { controller.current?.abort(); setToken(''); router.replace('/reset-password'); }
      else if (event === 'SIGNED_OUT' || (scope.current && session?.user?.id !== scope.current)) invalidate();
    });
    const initialize = async () => {
      try {
        const { error: initError } = await supabase.auth.initialize();
        if (initError) throw initError;
        if (recoveryGate.snapshot().status === 'ready') { router.replace('/reset-password'); return; }
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!alive.current) return;
        if (!data.session) { invalidate(); return; }
        const current = data.session.user;
        scope.current = current.id;
        setUser(current);
        setName(typeof current.user_metadata?.store_name === 'string' ? current.user_metadata.store_name.slice(0, 100) : '');
        try {
          const saved = JSON.parse(sessionStorage.getItem(`sellio-kaspi-resume:${current.id}`) ?? 'null');
          if (typeof saved?.store?.id === 'string' && saved.store.id.length > 0 && saved.store.id.length <= 200
            && typeof saved.store.name === 'string' && saved.store.name.length <= 100
            && typeof saved.cursor === 'string' && saved.cursor.length < 4096) {
            setStore(saved.store); setCursor(saved.cursor); setStep(2);
          }
        } catch { /* Resume is optional; credentials are never stored here. */ }
      } catch (authError) { if (alive.current) setError(getAuthErrorMessage(authError)); }
      finally { if (alive.current) setChecking(false); }
    };
    initialize();
    return () => { alive.current = false; pause.current = true; controller.current?.abort(); subscription.unsubscribe(); };
  }, [router]);

  useEffect(() => { title.current?.focus(); }, [step]);

  const request = async (path, input) => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (!alive.current) throw new DOMException('Page unmounted', 'AbortError');
    if (sessionError || !data.session || data.session.user.id !== scope.current) throw Error('Сессия истекла. Войдите заново.');
    controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 55000);
    try {
      const response = await fetch(path, {
        method: 'POST', cache: 'no-store', signal: controller.current.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify(input)
      });
      const result = await response.json();
      if (response.status === 401) { setToken(''); router.replace('/login'); }
      if (!response.ok) {
        const failure = Error(result.error ?? 'Запрос не выполнен. Попробуйте снова.');
        failure.code = result.code;
        throw failure;
      }
      return result.data;
    } finally { clearTimeout(timer); }
  };

  const saveResume = (nextCursor, connected = store) => {
    try {
      sessionStorage.setItem(`sellio-kaspi-resume:${scope.current}`, JSON.stringify({
        store: { id: connected.id, name: connected.name }, cursor: nextCursor
      }));
    } catch { /* In-memory resume remains available while this page is open. */ }
  };

  const verify = async (event) => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy('verify'); setError('');
    try {
      const result = await request('/api/kaspi/verify', { name, token, ...(store ? { storeId: store.id } : {}) });
      if (!alive.current) return;
      setToken(''); setStore(result.store); setCursor(null); setSummary(null); setProgress(null);
      try { sessionStorage.removeItem(`sellio-kaspi-resume:${scope.current}`); } catch { /* Optional storage. */ }
    } catch (requestError) { if (alive.current) setError(requestError.name === 'AbortError' ? 'Запрос прерван. Проверьте подключение и повторите.' : requestError.message); }
    finally { pending.current = false; if (alive.current) setBusy(null); }
  };

  const importOrders = async () => {
    if (pending.current || !store) return;
    pending.current = true; pause.current = false; setPaused(false); setBusy('sync'); setError('');
    let nextCursor = cursor;
    try {
      while (alive.current && !pause.current) {
        const result = await request('/api/kaspi/sync', { storeId: store.id, ...(nextCursor ? { cursor: nextCursor } : {}) });
        if (!alive.current || !scope.current) return;
        nextCursor = result.cursor;
        setCursor(nextCursor); setProgress(result.progress); saveResume(nextCursor);
        if (result.complete) { setSummary(result.summary); setStep(3); pause.current = true; break; }
      }
    } catch (requestError) {
      if (alive.current) {
        if (requestError.code === 'KASPI_RESTART_REQUIRED') {
          setCursor(null); setProgress(null); setSummary(null); setStep(2);
          try { sessionStorage.removeItem(`sellio-kaspi-resume:${scope.current}`); } catch { /* Optional storage. */ }
        }
        setError(requestError.name === 'AbortError' ? 'Запрос прерван. Повторите: уже сохранённые заказы не будут задвоены.' : requestError.message);
      }
    } finally {
      pending.current = false; pause.current = true;
      if (alive.current) { setPaused(true); setBusy(null); }
    }
  };

  const logout = async () => {
    if (pending.current) return;
    pending.current = true; setBusy('logout'); setToken(''); setError('');
    try {
      const { error: authError } = await supabase.auth.signOut();
      if (authError) throw authError;
      router.replace('/login');
    } catch (authError) { if (alive.current) setError(getAuthErrorMessage(authError)); }
    finally { pending.current = false; if (alive.current) setBusy(null); }
  };

  if (checking) return <main className="mx-auto max-w-[680px] space-y-6 px-6 py-20" role="status"><p>Проверяем сессию…</p><Skeleton className="h-12 w-2/3" /><Skeleton className="h-64 w-full" /></main>;
  if (!user) return <main className="mx-auto max-w-[680px] p-10"><h1 className="text-2xl font-bold">Требуется вход</h1><p role="alert" className="my-4 text-muted">{error || 'Supabase не настроен. Обратитесь к администратору.'}</p><Button onClick={() => router.push('/login')}>Перейти ко входу</Button></main>;

  return (
    <>
      <nav aria-label="Навигация" className="flex flex-wrap items-center justify-between gap-4 border-b border-warm px-6 py-4 sm:px-10">
        <div className="flex items-center gap-2 font-extrabold"><span className="rounded-lg bg-primary px-3 py-2 text-paper">S</span><span className="text-xl">Sellio</span></div>
        <div className="flex items-center gap-3 text-sm"><span aria-label="Русский язык">RU</span><span className="text-light">|</span><Button variant="icon" disabled title="Английский перевод пока недоступен">EN</Button><Button variant="ghost" onClick={logout} disabled={Boolean(busy)} loading={busy === 'logout'}>Выйти</Button></div>
      </nav>
      <main className="mx-auto w-full max-w-[728px] px-4 py-8 sm:px-6 sm:py-16">
        <Card className="break-words p-6 sm:p-10">
          <ol aria-label="Этапы подключения" className="mb-8 grid grid-cols-4 gap-2">
            {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} className="min-w-0 break-words"><div className={`mb-3 h-1.5 rounded-full ${index <= step ? 'bg-primary' : 'bg-warm'}`} /><span className={`mb-2 flex h-7 w-7 items-center justify-center rounded-full font-inter text-xs font-bold ${index <= step ? 'bg-primary-light text-primary-dark' : 'bg-panel text-muted'}`}>{index < step ? '✓' : index + 1}</span><span className={`block text-[11px] sm:text-xs ${index === step ? 'font-bold text-dark' : 'text-muted'}`}>{label}</span></li>)}
          </ol>
          <h1 ref={title} tabIndex={-1} className="text-[28px] font-extrabold leading-9">{headings[step]}</h1>
          <p className="mt-3 text-[15px] leading-6 text-muted">{['Начните с Kaspi. Остальные площадки появятся после запуска.', 'Проверим доступ к заказам и зашифруем токен на сервере.', 'Импортируем заказы за последние 14 дней, а не текущие остатки.', 'Импорт завершён. Откройте обзор и заказы; остатки и прибыль пока недоступны.'][step]}</p>

          {step === 0 && <div className="mt-8 space-y-6"><div className="grid gap-3 sm:grid-cols-3"><Button variant="ghost" aria-pressed={selected} onClick={() => setSelected(!selected)} className={`min-h-28 flex-col ${selected ? 'border-primary bg-primary-light' : ''}`}><span className="text-lg">Kaspi</span><span className="text-xs text-muted">{selected ? 'Выбран' : 'Выбрать'}</span></Button>{['Ozon', 'Wildberries'].map((label) => <Button key={label} variant="ghost" disabled className="min-h-28 flex-col"><span>{label}</span><span className="text-xs">После запуска</span></Button>)}</div><Button className="w-full" disabled={!selected} onClick={() => setStep(1)}>Продолжить</Button></div>}

          {step === 1 && <form onSubmit={verify} className="mt-8 space-y-5"><Input id="kaspi-name" label="Имя магазина" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoComplete="organization" required disabled={Boolean(busy)} hint="Ваше название, а не подтверждённое Kaspi имя продавца." /><Input id="kaspi-token" label="API токен Kaspi" type="password" value={token} onChange={(event) => setToken(event.target.value)} maxLength={4096} autoComplete="off" spellCheck={false} required disabled={Boolean(busy)} hint="Токен не сохраняется в браузере. Не отправляйте его в чат." /><details className="rounded-lg bg-panel p-4 text-sm"><summary className="cursor-pointer font-bold">Где найти токен?</summary><p className="mt-3 leading-6 text-muted">Откройте настройки API в кабинете продавца Kaspi. Убедитесь, что разрешено чтение заказов.</p><a href="https://guide.kaspi.kz/partner/ru/shop/api/general/q3193" target="_blank" rel="noreferrer" className="mt-2 inline-block text-primary-dark underline">Официальная инструкция Kaspi</a></details>{store && <p role="status" className="text-sm text-success">Доступ проверен: {store.name}. {token ? 'Проверьте новый токен перед продолжением.' : 'Можно начать импорт.'}</p>}<Button type="submit" variant="ghost" className="w-full" loading={busy === 'verify'} disabled={Boolean(busy) || !token}>{busy === 'verify' ? 'Проверяем…' : 'Проверить и сохранить токен'}</Button><div className="flex gap-3"><Button variant="ghost" disabled={Boolean(busy)} onClick={() => { setToken(''); setStep(0); }}>Назад</Button><Button className="flex-1" disabled={!store || Boolean(busy) || Boolean(token)} onClick={() => setStep(2)}>Продолжить</Button></div></form>}

          {step === 2 && <div className="mt-8 space-y-5"><div className="rounded-lg border border-warm bg-panel p-5" role="status" aria-live="polite"><p className="font-bold">{busy === 'sync' ? 'Обрабатываем страницы Kaspi…' : error ? 'Импорт остановлен' : 'Импорт на паузе'}</p><p className="mt-2 font-inter text-sm text-muted">Сохранённых страниц: {progress?.processedPages ?? 0}. Проверено состояний: {progress?.completedStates ?? 0} из 6.</p>{progress?.state && <p className="mt-2 font-inter text-xs text-muted">Последняя страница: {progress.state}, {progress.page} из {progress.pageCount}</p>}<p className="mt-3 text-xs leading-5 text-muted">Это фактически обработанные страницы, не процент всех заказов. Закрытие вкладки останавливает работу. Продолжение доступно в этой вкладке после перезагрузки, пока курсор действителен (24 часа).</p></div>{busy === 'sync' && <div aria-label="Ожидаем реальные данные" className="grid grid-cols-2 gap-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="col-span-2 h-24 w-full" /></div>}<div className="flex flex-wrap gap-3">{busy === 'sync' ? <Button variant="ghost" onClick={() => { pause.current = true; setPaused(true); }} disabled={paused}>{paused ? 'Пауза после текущей страницы…' : 'Пауза после страницы'}</Button> : <><Button variant="ghost" onClick={() => setStep(1)}>Назад</Button><Button onClick={importOrders}>{cursor ? 'Продолжить / повторить' : 'Начать импорт'}</Button>{cursor && <Button variant="ghost" onClick={() => { setCursor(null); setProgress(null); setError(''); try { sessionStorage.removeItem(`sellio-kaspi-resume:${scope.current}`); } catch { /* Optional storage. */ } }}>Новый импорт</Button>}</>}</div></div>}

          {step === 3 && summary && <div className="mt-8 space-y-5"><div className="rounded-lg bg-success/10 p-5"><p className="font-bold text-success">{summary.orders ? 'Заказы сохранены' : 'Заказов за этот период не найдено'}</p><p className="mt-2 font-inter text-xs text-muted">{new Date(summary.start).toLocaleString('ru-KZ', { timeZone: 'Asia/Almaty' })} — {new Date(summary.end).toLocaleString('ru-KZ', { timeZone: 'Asia/Almaty' })}</p></div><dl className="grid gap-3 sm:grid-cols-2">{[['Уникальные заказы', summary.orders], ['Товары, наблюдаемые в заказах', summary.observedProducts], ['Сумма всех заказов (не прибыль)', money(summary.totalAmount)], ['Сумма завершённых заказов', money(summary.completedAmount)]].map(([label, value]) => <div key={label} className="rounded-lg border border-warm p-4"><dt className="text-xs leading-5 text-muted">{label}</dt><dd className="mt-2 font-inter text-xl font-bold">{value}</dd></div>)}</dl><p className="text-xs leading-5 text-muted">Товары считаются по ID каталога Kaspi в полученных позициях заказов; это не полный каталог и не SKU продавца. {!summary.entriesComplete && 'Часть позиций не получена; наблюдения неполны.'} Завершённых заказов: {summary.completedOrders}.</p><Button className="w-full" onClick={() => router.push('/dashboard')}>Открыть Dashboard</Button><Button disabled variant="ghost" className="w-full" title="Telegram-бот не реализован">Telegram — пока недоступен</Button><Button variant="ghost" className="w-full" onClick={() => setStep(2)}>Вернуться к импорту</Button></div>}

          {error && <p role="alert" className="mt-5 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm leading-6 text-danger">{error}</p>}
          <p className="mt-8 border-t border-warm pt-5 text-xs leading-5 text-muted">Текущие остатки: недоступны через подтверждённый публичный API чтения Kaspi. Существующие базовые остатки не изменяются. Заказанное количество не означает наличие на складе. Импорт не является атомарным снимком при переходах заказов между состояниями.</p>
        </Card>
      </main>
    </>
  );
}
