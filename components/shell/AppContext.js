'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { recoveryGate, supabase } from '@/lib/supabase';
import { createRequestGate, defaultPeriod } from '@/lib/reportView';
import Skeleton from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import useResource from './useResource';

const Context = createContext(null);
export const useApp = () => useContext(Context);
export default function AppContext({ children }) {
  const router = useRouter();
  const [session, setSession] = useState(null), [checking, setChecking] = useState(true);
  const [storeState, setStoreState] = useState({ owner: '', data: [] }), [selectedStoreId, setStoreId] = useState('');
  const stores = storeState.owner === session?.user?.id ? storeState.data : [];
  const storeId = stores.some(s => s.id === selectedStoreId) ? selectedStoreId : '';
  const setStores = data => setStoreState({ owner: session?.user?.id ?? '', data });
  const [period, setPeriod] = useState(defaultPeriod), [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(''), [menu, setMenu] = useState(false);
  const gate = useRef(createRequestGate());
  const [profileRefresh, setProfileRefresh] = useState(0);
  const profileState = useResource('/api/settings/profile', session, '', profileRefresh + refresh, Boolean(session));
  const profile = profileState.data?.data ?? null;
  useEffect(() => {
    if (!supabase) { setError('Supabase не настроен. Обратитесь к администратору.'); setChecking(false); return; }
    let active = true, observed = false;
    const accept = next => { if (!active) return; if (recoveryGate.snapshot().status === 'ready') { setSession(null); router.replace('/reset-password'); return; } setSession(next); setChecking(false); if (!next) { gate.current.cancel(); setStoreState({ owner: '', data: [] }); setStoreId(''); router.replace('/login'); } };
    const { data } = supabase.auth.onAuthStateChange((event, next) => { observed = true; if (event === 'PASSWORD_RECOVERY') { gate.current.cancel(); setSession(null); router.replace('/reset-password'); return; } accept(next); });
    supabase.auth.getSession().then(({ data: result, error: issue }) => { if (!active || observed) return; if (issue) { setError('Не удалось проверить сессию.'); setChecking(false); } else accept(result.session); });
    return () => { active = false; data.subscription.unsubscribe(); gate.current.cancel(); };
  }, [router]);
  useEffect(() => {
    setStores([]); setStoreId('');
    if (!session) return;
    const request = gate.current.begin();
    const load = async () => {
      setError('');
      try {
        const response = await fetch('/api/stores', { signal: request.signal, headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' });
        const payload = await response.json();
        if (!request.current()) return;
        if (!response.ok) throw Error(payload.error);
        setStores(payload.data); setStoreId(payload.data[0]?.id ?? '');
      } catch (issue) { if (request.current()) setError(issue.message || 'Не удалось прочитать магазины.'); }
    };
    load(); return () => gate.current.cancel();
  }, [session?.access_token]);
  const logout = async () => {
    gate.current.cancel(); setSession(null); setStores([]); setStoreId('');
    const result = await supabase?.auth.signOut();
    if (result?.error) { setError('Не удалось завершить выход. Повторите попытку.'); return; }
    router.replace('/login');
  };
  if (checking) return <main className="p-6" role="status"><p>Проверяем сессию…</p><Skeleton className="mt-6 h-48 w-full" /></main>;
  if (!session) return <main className="p-6"><p role="alert">{error || 'Войдите для доступа к кабинету.'}</p><Link href="/login" className="text-primary-dark underline">Войти</Link></main>;
  return <Context.Provider value={{ session, storeId, period, setPeriod, refresh, stores, profile, profileState, refreshProfile: () => setProfileRefresh(v => v + 1) }}>
    <div className="min-h-screen lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
      <Sidebar user={session.user} profile={profile} menu={menu} close={() => setMenu(false)} logout={logout} />
      <div className="min-w-0 pb-20 lg:pb-0"><TopBar stores={stores} storeId={storeId} selectStore={setStoreId} period={period} setPeriod={setPeriod} refresh={() => setRefresh(v => v + 1)} menu={() => setMenu(v => !v)} />
        <main className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
          {error && <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}<Button variant="ghost" className="ml-3" onClick={() => window.location.reload()}>Повторить</Button></div>}
          {!storeId && !error && <div className="rounded-xl border border-warm bg-paper p-6"><h2 className="font-bold">Подключите магазин Kaspi</h2><p className="mt-2 text-sm text-muted">Нет подключённого магазина. После импорта здесь появятся ваши заказы.</p><Link href="/onboarding" className="mt-3 inline-block font-bold text-primary-dark underline">Подключить Kaspi и импортировать</Link></div>}
          {children}
        </main>
      </div>
    </div>
  </Context.Provider>;
}
