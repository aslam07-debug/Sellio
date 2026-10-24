'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { createRequestGate } from '@/lib/reportView';

export default function CommentEditor({ order, query, token }) {
  const inputId = useId();
  const [value, setValue] = useState(order.comment), [version, setVersion] = useState(order.updatedAt);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const gate = useRef(createRequestGate());
  useEffect(() => () => gate.current.cancel(), []);
  const save = async () => {
    if (busy) return;
    const request = gate.current.begin(); setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/kaspi/orders?${query}`, { method: 'PATCH', signal: request.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: order.id, comment: value, expectedUpdatedAt: version }) });
      const payload = await response.json();
      if (!request.current()) return;
      if (!response.ok) throw Error(payload.error);
      setVersion(payload.data.updatedAt); setMessage('Сохранено');
    } catch (issue) { if (request.current()) setMessage(issue.message || 'Не удалось сохранить.'); }
    finally { if (request.current()) setBusy(false); }
  };
  return <div className="min-w-40 space-y-2"><Input id={inputId} label="Комментарий" value={value} onChange={e => setValue(e.target.value)} maxLength={2000} disabled={busy} /><Button variant="ghost" className="min-h-9 px-3 py-2 text-xs" onClick={save} loading={busy} disabled={!version} title={!version ? 'Нет версии updated_at: проверьте схему' : undefined}>Сохранить</Button>{message && <p role="status" className="max-w-64 text-xs text-muted">{message}</p>}</div>;
}
