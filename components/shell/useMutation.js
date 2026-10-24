'use client';
import { useEffect, useRef, useState } from 'react';
import { createRequestGate } from '@/lib/reportView';

// Call inside owner/store-keyed forms so unmount cancels both delivery and UI effects.
export default function useMutation(session) {
  const gate = useRef(createRequestGate()), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => () => gate.current.cancel(), []);
  return { busy, error, clearError: () => setError(''), async run(endpoint, input, success, method = 'POST') {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const request = gate.current.begin();
    try {
      const response = await fetch(endpoint, { method, headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: request.signal, cache: 'no-store' });
      const payload = await response.json(); if (!request.current()) return;
      if (!response.ok) throw Error(payload.error);
      success(payload.data);
    } catch (issue) { if (request.current()) setError(issue.message || 'Не удалось сохранить. Повторите позже.'); }
    finally { pending.current = false; if (request.current()) setBusy(false); }
  } };
}
