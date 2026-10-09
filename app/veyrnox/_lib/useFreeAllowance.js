'use client';
import { useCallback, useEffect, useState } from 'react';
import { gatewayFetch } from './gateway';

// {model_id: free jobs left today}. Empty when the feature is off, the account is signed out, or the read fails:
// no banner is the safe answer, because the paid price is always what the server charges when nothing is free.
export function useFreeAllowance() {
  const [left, setLeft] = useState({});
  const load = useCallback(async () => {
    try {
      const r = await gatewayFetch('/free-allowance');
      setLeft(r && r.enabled && r.left && typeof r.left === 'object' ? r.left : {});
    } catch {
      setLeft({});
    }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('veyrnox:balance-changed', load);
    return () => window.removeEventListener('veyrnox:balance-changed', load);
  }, [load]);
  return left;
}
