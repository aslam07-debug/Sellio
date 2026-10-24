'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Skeleton from '@/components/ui/Skeleton';
import { recoveryGate, supabase } from '@/lib/supabase';
import { getAuthErrorMessage, validateResetPassword } from '@/lib/utils';

export default function ResetPasswordForm() {
  const [gate, setGate] = useState({ status: 'checking', error: null });
  const [values, setValues] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const pending = useRef(false);
  const active = useRef(false);
  const passwordRef = useRef(null);
  const confirmRef = useRef(null);
  const statusRef = useRef(null);

  useEffect(() => {
    active.current = true;
    const read = () => { if (active.current) setGate(recoveryGate.snapshot()); };
    const unsubscribe = recoveryGate.subscribe(read);
    read();
    // The SDK can emit PASSWORD_RECOVERY on a timer after initialize resolves.
    // Recheck expiration while mounted, without calling auth inside its listener.
    const timer = window.setInterval(read, 1000);
    return () => { active.current = false; unsubscribe(); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    // Sync Next's hydrated router after the SDK consumes a verified recovery link.
    if (gate.status === 'ready' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [gate.status]);
  useEffect(() => { if (success) statusRef.current?.focus(); }, [success]);

  const submit = async (event) => {
    event.preventDefault();
    if (pending.current || success) return;
    const current = recoveryGate.snapshot();
    if (!supabase || current.status !== 'ready') { setGate(current); return; }
    setMessage('');
    const nextErrors = validateResetPassword(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      (nextErrors.password ? passwordRef : confirmRef).current?.focus();
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: values.password });
      if (error) throw error;
      recoveryGate.consume();
      if (active.current) { setValues({ password: '', confirmPassword: '' }); setSuccess(true); }
    } catch (error) {
      if (['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'bad_jwt'].includes(error?.code) || error?.status === 401 || error?.status === 403) recoveryGate.consume();
      if (active.current) setMessage(getAuthErrorMessage(error));
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };

  if (success) {
    return <Card className="p-8"><h1 ref={statusRef} tabIndex={-1} className="text-2xl font-extrabold">Пароль обновлён</h1><p role="status" className="mt-3 text-sm leading-6 text-muted">Новый пароль сохранён. Сессия восстановления остаётся активной; выйти можно на странице входа.</p><Link href="/login" className="mt-6 inline-block font-bold text-primary-dark hover:underline">Перейти ко входу</Link></Card>;
  }
  if (gate.status === 'checking') {
    return <div role="status" className="space-y-6"><p className="text-sm text-muted">Проверяем ссылку…</p><Skeleton className="h-10 w-56" /><Skeleton className="h-32 w-full" /></div>;
  }
  if (gate.status !== 'ready') {
    return <Card className="p-8"><h1 className="text-2xl font-extrabold">Ссылка недействительна</h1><p role="alert" className="mt-3 text-sm leading-6 text-muted">Откройте действующую ссылку из письма. Она могла истечь или уже быть использована. Обычный вход не даёт доступа к этой форме.</p>{message && <p role="alert" className="mt-4 text-sm text-danger">{message}</p>}<Link href="/forgot-password" className="mt-6 inline-block font-bold text-primary-dark hover:underline">Запросить новую ссылку</Link></Card>;
  }
  return (
    <div>
      <Link href="/login" className="text-sm font-bold text-muted hover:text-primary-dark">Назад ко входу</Link>
      <h1 className="mt-8 text-[32px] font-extrabold leading-10">Новый пароль</h1>
      <p className="mt-2 text-[15px] leading-6 text-muted">Создайте новый пароль для вашего кабинета.</p>
      <form noValidate onSubmit={submit} className="mt-8" aria-busy={busy}>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <legend className="sr-only">Новый пароль</legend>
          <Input ref={passwordRef} id="new-password" label="Новый пароль" type="password" autoComplete="new-password" minLength={8} placeholder="Минимум 8 символов" value={values.password} onChange={(event) => { setValues((previous) => ({ ...previous, password: event.target.value })); setErrors({}); }} error={errors.password} required />
          <Input ref={confirmRef} id="confirm-password" label="Повторите пароль" type="password" autoComplete="new-password" value={values.confirmPassword} onChange={(event) => { setValues((previous) => ({ ...previous, confirmPassword: event.target.value })); setErrors({}); }} error={errors.confirmPassword} required />
        </fieldset>
        {message && <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{message}</p>}
        <Button type="submit" className="mt-8 w-full" loading={busy}>{busy ? 'Сохраняем…' : 'Сохранить пароль'}</Button>
        <Link href="/forgot-password" className="mt-4 inline-block text-sm text-primary-dark hover:underline">Запросить новую ссылку</Link>
      </form>
    </div>
  );
}
