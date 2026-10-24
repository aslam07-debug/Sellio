'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Skeleton from '@/components/ui/Skeleton';
import { setAuthPersistence, supabase } from '@/lib/supabase';
import { getAuthErrorMessage, validateLogin } from '@/lib/utils';

const googleEnabled = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === 'true';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [storageWarning, setStorageWarning] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(Boolean(supabase));
  const pending = useRef(false);
  const active = useRef(false);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  useEffect(() => {
    active.current = true;
    if (!supabase) return () => { active.current = false; };
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (mounted) setSignedIn(Boolean(session));
    });
    const readSession = async () => {
      try {
        const { error: initializationError } = await supabase.auth.initialize();
        if (initializationError) throw initializationError;
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (mounted) setSignedIn(Boolean(data?.session));
      } catch (sessionError) {
        if (mounted) setError(getAuthErrorMessage(sessionError));
      } finally {
        if (mounted) setCheckingSession(false);
      }
    };
    readSession();
    return () => { mounted = false; active.current = false; subscription.unsubscribe(); };
  }, []);

  const authenticate = async (provider) => {
    if (pending.current || checkingSession || (provider === 'google' && !googleEnabled)) return;
    setError('');
    if (provider === 'email') {
      const nextErrors = validateLogin({ email, password });
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) {
        (nextErrors.email ? emailRef : passwordRef).current?.focus();
        return;
      }
    }
    if (!supabase) {
      setError('Вход пока не настроен. Обратитесь к администратору.');
      return;
    }
    pending.current = true;
    setBusy(provider);
    try {
      const persistence = setAuthPersistence(remember);
      setStorageWarning(persistence === 'memory' ? 'Хранилище браузера недоступно. Вход сохранится только до перезагрузки страницы.' : '');
      const result = provider === 'google'
        ? await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/login` } })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (active.current && provider === 'email') {
        setPassword('');
        setSignedIn(Boolean(result.data?.session));
        if (!result.data?.session) setError('Сессия не найдена. Попробуйте войти снова.');
      }
    } catch (authError) {
      if (active.current) setError(getAuthErrorMessage(authError));
    } finally {
      pending.current = false;
      if (active.current) setBusy(null);
    }
  };

  const signOut = async () => {
    if (pending.current || !supabase) return;
    pending.current = true;
    setBusy('signout');
    setError('');
    try {
      const { error: authError } = await supabase.auth.signOut();
      if (authError) throw authError;
      if (active.current) setSignedIn(false);
    } catch (authError) {
      if (active.current) setError(getAuthErrorMessage(authError));
    } finally {
      pending.current = false;
      if (active.current) setBusy(null);
    }
  };

  if (checkingSession) {
    return <div role="status" className="space-y-6"><p className="text-sm text-muted">Загружаем аккаунт…</p><Skeleton className="h-10 w-56" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (signedIn) {
    return (
      <Card className="p-8">
        <h1 className="text-2xl font-extrabold">Вы вошли в Sellio</h1>
        <p role="status" className="mt-3 text-sm leading-6 text-muted">Подключите Kaspi и импортируйте заказы за 14 дней. Аналитика строится по импортированным заказам; остатки ведутся вручную в Sellio, не загружаются со склада Kaspi.</p>
        <Link href="/dashboard" className="mt-5 inline-block font-bold text-primary-dark hover:underline">Открыть кабинет</Link>
        <Link href="/onboarding" className="mt-3 block font-bold text-primary-dark hover:underline">Подключить Kaspi</Link>
        {storageWarning && <p role="status" className="mt-4 text-sm text-muted">{storageWarning}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
        <Button variant="ghost" className="mt-6" onClick={signOut} loading={busy === 'signout'}>Выйти</Button>
      </Card>
    );
  }

  return (
    <div>
      <h1 className="text-[32px] font-extrabold leading-10 tracking-[-0.5px]">Вход в кабинет</h1>
      <p className="mt-2 text-[15px] leading-5 text-muted">Введите свои данные для доступа к аналитике.</p>
      <div className="mt-8 grid grid-cols-2 gap-3">
        <Button variant="ghost" className="font-semibold" onClick={() => authenticate('google')} loading={busy === 'google'} disabled={Boolean(busy) || !googleEnabled} title={!googleEnabled ? 'Вход через Google ещё не настроен' : undefined}><span aria-hidden="true" className="font-inter text-base text-danger">G</span>Google</Button>
        <Button variant="ghost" className="font-semibold" disabled title="Вход через Яндекс недоступен в текущей версии" aria-label="Яндекс — пока недоступен"><span aria-hidden="true" className="font-inter text-base text-danger">Я</span>Яндекс</Button>
      </div>
      <p className="sr-only">Яндекс пока недоступен. Google доступен после настройки провайдера.</p>
      <div className="mt-3 flex items-center gap-4 text-xs text-muted"><span className="h-px flex-1 bg-warm" /><span>или через почту</span><span className="h-px flex-1 bg-warm" /></div>
      <form noValidate onSubmit={(event) => { event.preventDefault(); authenticate('email'); }} className="mt-8" aria-busy={Boolean(busy)}>
        <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-4">
          <legend className="sr-only">Данные для входа</legend>
          <Input ref={emailRef} id="login-email" label="Email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => { setEmail(event.target.value); setErrors((previous) => ({ ...previous, email: undefined })); }} error={errors.email} placeholder="your@email.com" required />
          <Input ref={passwordRef} id="login-password" label="Пароль" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); setErrors((previous) => ({ ...previous, password: undefined })); }} error={errors.password} placeholder="Введите ваш пароль" required trailing={
            <Button variant="icon" className="min-h-10 px-3 py-2" onClick={() => setShowPassword((previous) => !previous)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword}>
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{!showPassword && <path d="m3 3 18 18" />}</svg>
            </Button>
          } />
          <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
            <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-4 w-4 accent-primary" aria-describedby="persistence-hint" />Запомнить меня</label>
            <Link href="/forgot-password" className="font-bold text-primary-dark hover:underline">Забыли пароль?</Link>
          </div>
          <p id="persistence-hint" className="text-xs leading-5 text-muted">Без галочки сессия сохраняется только в этой вкладке до её закрытия. С галочкой — между посещениями этого браузера.</p>
        </fieldset>
        {storageWarning && <p role="status" className="mt-4 text-sm text-muted">{storageWarning}</p>}
        {error && <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
        <Button type="submit" className="mt-8 w-full text-[15px]" loading={busy === 'email'} disabled={Boolean(busy)}>{busy === 'email' ? 'Входим…' : 'Войти'}</Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">Еще нет аккаунта? <Link href="/register" className="font-bold text-primary-dark hover:underline">Зарегистрироваться</Link></p>
    </div>
  );
}
