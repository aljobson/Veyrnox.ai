'use client';
import { useEffect, useState } from 'react';
import { probeConnection } from '../../../lib/connectionProbe.mjs';

// "Offline" is only shown after a real request fails (see lib/connectionProbe.mjs);
// while offline the check repeats until one succeeds.
const RETRY_MS = 5000;

/** @returns {boolean} false only when a real network request has just failed. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let retry = null;
    const verify = async () => {
      clearTimeout(retry);
      const reached = await probeConnection();
      if (cancelled) return;
      setOnline(reached);
      if (!reached) retry = setTimeout(verify, RETRY_MS);
    };
    const goOnline = () => { clearTimeout(retry); setOnline(true); };
    const maybeOffline = () => { verify(); };
    if (!navigator.onLine) maybeOffline();
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', maybeOffline);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', maybeOffline);
    };
  }, []);
  return online;
}
