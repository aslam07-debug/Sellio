'use client';
import { useEffect, useRef, useState } from 'react';
import { createRequestGate } from '@/lib/reportView';

// No order-period input: stock is a current local ledger, settings are account-wide.
export default function useResource(endpoint, session, query = '', refresh = 0, enabled = true) {
  const scope = `${session?.user?.id}:${session?.access_token}:${endpoint}:${query}:${refresh}:${enabled}`;
  const [state, setState] = useState({ scope: '', data: null, loading: false, error: '' });
  const gate = useRef(createRequestGate());
  useEffect(() => {
    const request = gate.current.begin();
    setState({ scope, data: null, loading: enabled, error: '' });
    if (enabled && session) (async () => {
      try {
        const response = await fetch(`${endpoint}${query ? `?${query}` : ''}`, { signal: request.signal, headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' });
        const data = await response.json(); if (!response.ok) throw Error(data.error);
        if (request.current()) setState({ scope, data, loading: false, error: '' });
      } catch (error) { if (request.current()) setState({ scope, data: null, loading: false, error: error.message || 'Не удалось загрузить данные.' }); }
    })();
    return () => gate.current.cancel();
  }, [scope]);
  return state.scope === scope ? state : { data: null, loading: enabled, error: '' };
}
