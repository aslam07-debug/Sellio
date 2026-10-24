'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { supabase } from '@/lib/supabase';
import { getAuthErrorMessage, validateEmail } from '@/lib/utils';

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const active = useRef(false);
  const emailRef = useRef(null);
  const statusRef = useRef(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (sent) statusRef.current?.focus(); }, [sent]);

  const submit = async (event) => {
    event.preventDefault();
    if (pending.current || sent) return;
    setMessage('');
    const nextErrors = validateEmail(email);
    setErrors(nextErrors);
    if (nextErrors.email) { emailRef.current?.focus(); return; }
    if (!supabase) { setMessage('Восстановление пока не настроено. Обратитесь к администратору.'); return; }
    pending.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`
      });
      if (error) throw error;
      if (active.current) setSent(true);
    } catch (error) {
      if (active.current) setMessage(getAuthErrorMessage(error));
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };

  return (
    <div>
      <Link href="/login" className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-primary-dark"><span aria-hidden="true">←</span>Назад ко входу</Link>
      <h1 className="mt-8 text-[32px] font-extrabold leading-10 tracking-[-0.5px]">Восстановление</h1>
      <p className="mt-2 text-[15px] leading-6 text-muted">Введите почту, привязанную к вашему кабинету. Мы пришлем ссылку для создания нового пароля.</p>
      {sent ? (
        <div ref={statusRef} tabIndex={-1} role="status" className="mt-8 rounded-xl border border-warm bg-paper p-6 text-sm leading-6">
          Если аккаунт с этой почтой существует, вы получите письмо со ссылкой для создания нового пароля. Проверьте папку «Спам».
        </div>
      ) : (
        <form noValidate onSubmit={submit} className="mt-8" aria-busy={busy}>
          <Input ref={emailRef} id="recovery-email" label="Email адрес" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="your@email.com" value={email} onChange={(event) => { setEmail(event.target.value); setErrors({}); }} error={errors.email} disabled={busy} required />
          {message && <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{message}</p>}
          <Button type="submit" className="mt-8 w-full text-[15px]" loading={busy}>{busy ? 'Отправляем…' : 'Отправить ссылку'}</Button>
        </form>
      )}
    </div>
  );
}
