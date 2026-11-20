'use client';
import { useEffect, useState } from 'react';
import { fetchSwapAvailability } from './templateSwapClient.mjs';
export function useTemplateSwapAvailable(id) {
  const [state, setState] = useState({ id: null, offer: null, loading: true });
  useEffect(() => {
    let controller;
    async function check() {
      controller?.abort(); controller = new AbortController();
      const signal = controller.signal;
      const offer = await fetchSwapAvailability(id, fetch, signal);
      if (!signal.aborted) setState({ id, offer, loading: false });
    }
    const refresh = event => { if (event.detail?.id === id) void check(); };
    check(); window.addEventListener('focus', check);
    window.addEventListener('veyrnox:template-swap-refresh', refresh);
    return () => { controller?.abort(); window.removeEventListener('focus', check); window.removeEventListener('veyrnox:template-swap-refresh', refresh); };
  }, [id]);
  return state.id === id ? state : { id, offer: null, loading: Boolean(id) };
}
