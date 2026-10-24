'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppContext';
import { createRequestGate } from '@/lib/reportView';

export default function useReport(endpoints, filters = '') {
  const app = useApp();
  const { session, storeId, period, refresh } = app;
  const query = new URLSearchParams({ storeId, start: period.start, end: period.end });
  const scope = `${session?.user?.id}:${session?.access_token}:${query}:${filters}:${refresh}`;
  const [state, setState] = useState({ scope: '', loading: true, data: null, error: '' });
  const gate = useRef(createRequestGate());
  const names = endpoints.join('|');
  useEffect(() => {
    const request = gate.current.begin();
    setState({ scope, loading: Boolean(storeId), data: null, error: '' });
    if (!storeId) return () => gate.current.cancel();
    const load = async () => {
      try {
        const payloads = await Promise.all(names.split('|').map(async endpoint => {
          const response = await fetch(`${endpoint}?${query}${filters ? `&${filters}` : ''}`, { headers: { Authorization: `Bearer ${session.access_token}` }, signal: request.signal, cache: 'no-store' });
          const payload = await response.json(); if (!response.ok) throw Error(payload.error); return payload;
        }));
        if (request.current()) setState({ scope, loading: false, data: payloads, error: '' });
      } catch (issue) { if (request.current()) setState({ scope, loading: false, data: null, error: issue.message || 'Не удалось загрузить данные.' }); }
    };
    load(); return () => gate.current.cancel();
  }, [scope, names]);
  return { ...app, ...(state.scope === scope ? state : { loading: Boolean(storeId), data: null, error: '' }), query: query.toString() };
}
