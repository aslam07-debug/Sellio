'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Skeleton from '@/components/ui/Skeleton';
import { isSupabaseConfigured, setAuthPersistence, supabase } from '@/lib/supabase';
import { getAuthErrorMessage, plans, requestedPlan, validateRegistration } from '@/lib/utils';

const googleEnabled = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === 'true';

export default function RegisterForm() {
  const [values, setValues] = useState({ storeName: '', email: '', password: '', plan: 'starter' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const pending = useRef(false);
  const storeRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const statusRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setValues((previous) => ({ ...previous, plan: requestedPlan(params.get('plan')) }));
    if (!supabase) return;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (params.has('error') || hash.has('error')) {
      setMessage('Ссылка недействительна или срок её действия истёк. Попробуйте войти снова.');
      window.history.replaceState(null, '', '/register');
      return;
    }
    if (params.get('auth') !== 'callback' && params.get('confirmed') !== '1') return;
    let active = true;
    const completeAuth = async () => {
      setBusy('callback');
      try {
        const { error: initializationError } = await supabase.auth.initialize();
        if (initializationError) throw initializationError;
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!active) return;
        if (data?.session) {
          if (params.get('auth') === 'callback') {
            let preferences = null;
            try {
              const saved = window.sessionStorage.getItem('sellio-registration-preferences');
              window.sessionStorage.removeItem('sellio-registration-preferences');
              preferences = saved ? JSON.parse(saved) : null;
            } catch {
              // Storage may be unavailable; authorization can still complete.
            }
            if (preferences && plans.some((plan) => plan.id === preferences.requested_plan)) {
              const metadata = { requested_plan: preferences.requested_plan };
              if (typeof preferences.store_name === 'string' && preferences.store_name.trim().length > 0 && preferences.store_name.length <= 100) {
                metadata.store_name = preferences.store_name.trim();
              }
              const { error: metadataError } = await supabase.auth.updateUser({ data: metadata });
              if (metadataError && active) setMessage('Вход завершён, но сохранить настройки магазина не удалось. Их нужно будет выбрать при подключении Kaspi.');
            }
          }
          if (active) setSuccess({ type: 'signed-in' });
        }
        else setMessage('Сессия не найдена. Войдите по email и паролю.');
      } catch (error) {
        if (active) setMessage(getAuthErrorMessage(error));
      } finally {
        if (active) {
          setBusy(null);
          window.history.replaceState(null, '', '/register');
        }
      }
    };
    completeAuth();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (success) statusRef.current?.focus();
  }, [success]);

  const updateField = (event) => {
    const { name, value } = event.target;
    setValues((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: undefined }));
    setMessage('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (pending.current) return;
    setMessage('');
    const nextErrors = validateRegistration(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const firstRef = nextErrors.storeName ? storeRef : nextErrors.email ? emailRef : passwordRef;
      firstRef.current?.focus();
      return;
    }
    if (!isSupabaseConfigured) {
      setMessage('Регистрация пока не настроена. Обратитесь к администратору.');
      return;
    }
    pending.current = true;
    setBusy('email');
    try {
      setAuthPersistence(true);
      const { data, error } = await supabase.auth.signUp({
        email: values.email.trim(),
        password: values.password,
        options: {
          emailRedirectTo: `${window.location.origin}/register?confirmed=1`,
          // Preferences only. Never grant paid access from user-controlled metadata.
          data: { store_name: values.storeName.trim(), requested_plan: values.plan }
        }
      });
      if (error) throw error;
      setValues((previous) => ({ ...previous, password: '' }));
      setSuccess(data?.session ? { type: 'signed-in' } : { type: 'email', email: values.email.trim() });
    } catch (error) {
      setMessage(getAuthErrorMessage(error));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };

  const signInWithGoogle = async () => {
    if (pending.current) return;
    setMessage('');
    if (!supabase) {
      setMessage('Вход пока не настроен. Обратитесь к администратору.');
      return;
    }
    pending.current = true;
    setBusy('google');
    try {
      setAuthPersistence(true);
      try {
        window.sessionStorage.setItem('sellio-registration-preferences', JSON.stringify({
          store_name: values.storeName.trim(), requested_plan: values.plan
        }));
      } catch {
        // Never store credentials. Optional preferences may be lost if storage is blocked.
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/register?auth=callback` }
      });
      if (error) throw error;
    } catch (error) {
      setMessage(getAuthErrorMessage(error));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };

  if (success) {
    return (
      <Card className="p-6 sm:p-8">
        <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-2xl text-success" aria-hidden="true">✓</span>
        <h1 ref={statusRef} tabIndex={-1} className="text-2xl font-extrabold">{success.type === 'email' ? 'Проверьте почту' : 'Вы вошли в Sellio'}</h1>
        <div role="status" className="mt-3 text-sm leading-6 text-muted">
          {success.type === 'email'
            ? <p>Если этот адрес доступен для регистрации, письмо с подтверждением отправлено на <strong className="break-all font-inter text-dark">{success.email}</strong>. Проверьте папку «Спам» и перейдите по ссылке в письме.</p>
            : <p>Авторизация завершена. Подключите Kaspi и импортируйте заказы за 14 дней. Текущие остатки не загружаются. Платный тариф автоматически не активируется.</p>}
        </div>
        {message && <p role="alert" className="mt-4 text-sm leading-5 text-warning">{message}</p>}
        <Link href={success.type === 'email' ? '/login' : '/dashboard'} className="mt-6 inline-block text-sm font-bold text-primary-dark underline-offset-4 hover:underline">{success.type === 'email' ? 'Войти в систему' : 'Открыть кабинет'}</Link>
      </Card>
    );
  }

  if (busy === 'callback') {
    return (
      <div role="status" aria-live="polite" className="space-y-6">
        <p className="text-sm text-muted">Завершаем вход…</p>
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  return (
    <div>
      <header>
        <h1 className="text-[32px] font-extrabold leading-10 tracking-[-0.5px]">Регистрация</h1>
        <p className="mt-2 text-[15px] leading-5 text-muted">Создайте аккаунт для подключения Kaspi. Для работы нужна настроенная серверная конфигурация.</p>
      </header>

      <div className="mt-8">
        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" className="font-semibold" onClick={signInWithGoogle} loading={busy === 'google'} disabled={Boolean(busy) || !googleEnabled} title={!googleEnabled ? 'Вход через Google ещё не настроен' : undefined}>
            <span aria-hidden="true" className="font-inter text-base font-bold text-danger">G</span>Google
          </Button>
          <Button variant="ghost" className="font-semibold" disabled title="Вход через Яндекс недоступен в текущей версии" aria-label="Яндекс — пока недоступен">
            <span aria-hidden="true" className="font-inter text-base font-bold text-danger">Я</span>Яндекс
          </Button>
        </div>
        <p className="sr-only">Яндекс пока недоступен. Google доступен после настройки провайдера.</p>
        <div className="mt-3 flex items-center gap-4 text-xs leading-4 text-muted">
          <span className="h-px flex-1 bg-warm" /><span>или через почту</span><span className="h-px flex-1 bg-warm" />
        </div>
      </div>

      <form noValidate onSubmit={submit} className="mt-8" aria-busy={Boolean(busy)}>
        <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-4">
          <legend className="sr-only">Данные аккаунта</legend>
          <Input ref={storeRef} id="store-name" name="storeName" label="Имя магазина" placeholder="Например, MyStore" value={values.storeName} onChange={updateField} error={errors.storeName} autoComplete="organization" maxLength={100} required />
          <Input ref={emailRef} id="email" name="email" type="email" label="Email" placeholder="your@email.com" value={values.email} onChange={updateField} error={errors.email} autoComplete="email" autoCapitalize="none" spellCheck={false} required />
          <Input ref={passwordRef} id="password" name="password" type={showPassword ? 'text' : 'password'} label="Пароль" placeholder="Минимум 8 символов" value={values.password} onChange={updateField} error={errors.password} autoComplete="new-password" minLength={8} required trailing={
            <Button variant="icon" className="min-h-10 px-3 py-2" onClick={() => setShowPassword((previous) => !previous)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword}>
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
                {!showPassword && <path d="m3 3 18 18" />}
              </svg>
            </Button>
          } />
          <fieldset className="min-w-0" aria-describedby={errors.plan ? 'plan-error' : undefined}>
            <legend className="text-[13px] font-bold leading-4">Предпочтительный тариф</legend>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:gap-3">
              {plans.map((plan) => (
                <label key={plan.id} className="relative min-w-0 cursor-pointer">
                  <input className="peer sr-only" type="radio" name="plan" value={plan.id} checked={values.plan === plan.id} onChange={updateField} />
                  <span className="block rounded-lg border border-warm bg-paper p-2 peer-checked:border-primary peer-checked:bg-primary-light peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-dark peer-disabled:cursor-not-allowed sm:p-3">
                    <span className="flex items-center justify-between gap-1 text-[11px] font-bold leading-4 sm:text-[13px]">
                      <span className="min-w-0 break-words">{plan.name}</span>
                      <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${values.plan === plan.id ? 'bg-primary' : 'bg-warm'}`} />
                    </span>
                    <span className={`mt-1 block font-inter text-xs font-semibold leading-4 ${values.plan === plan.id ? 'text-primary-dark' : 'text-muted'}`}>{plan.price}</span>
                  </span>
                </label>
              ))}
            </div>
            {errors.plan && <p id="plan-error" className="mt-1 text-xs text-danger">{errors.plan}</p>}
            <p className="mt-3 text-xs leading-5 text-muted">Платные цены, периоды оплаты и лимиты ещё не подтверждены. Выбор сохраняется как пожелание, не списывает деньги и не активирует платный доступ.</p>
          </fieldset>
        </fieldset>

        {message && <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm leading-5 text-danger">{message}</p>}
        <Button type="submit" className="mt-8 min-h-[47px] w-full text-[15px]" loading={busy === 'email'} disabled={Boolean(busy)}>{busy === 'email' ? 'Создаём аккаунт…' : 'Создать аккаунт'}</Button>
        {busy === 'callback' && <p role="status" className="mt-3 text-sm text-muted">Завершаем вход…</p>}
        <p className="mt-4 flex flex-wrap justify-center gap-x-1.5 text-sm leading-5 text-muted">Уже есть аккаунт?<Link href="/login" className="font-bold text-primary-dark underline-offset-4 hover:underline">Войти в систему</Link></p>
      </form>
    </div>
  );
}
