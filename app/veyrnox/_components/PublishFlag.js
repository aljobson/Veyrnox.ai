'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';

import { getSession, onSessionChange } from '../../lib/authClient.js';
import { gatewayFetch } from '../_lib/gateway.js';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';

// The server sends rollout booleans only, never the tester allowlist.
const PublishFlag = createContext(false);

export function PublishFlagProvider({ enabled, pilot = false, children }) {
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  const [allowedAccount, setAllowedAccount] = useState('');
  useEffect(() => {
    if (!pilot || !account || enabled) return;
    let cancelled = false;
    gatewayFetch('/social/access').then((result) => {
      if (!cancelled) setAllowedAccount(result.enabled === true ? account : '');
    }).catch(() => { if (!cancelled) setAllowedAccount(''); });
    return () => { cancelled = true; };
  }, [pilot, account, enabled]);
  return <PublishFlag.Provider value={enabled === true || (pilot && Boolean(account) && allowedAccount === account)}>{children}</PublishFlag.Provider>;
}

export function usePublishEnabled() {
  return useContext(PublishFlag);
}
