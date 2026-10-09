'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { getSession, onSessionChange } from '../../lib/authClient.js';
import { gatewayFetch } from '../_lib/gateway';
import { rememberReferral, recallReferral, forgetReferral, attachIsFinal } from '../_lib/referralCapture';

// Renders nothing. Picks ?ref=<code> off a friend's link (and tidies the address bar), then, once the visitor is signed in, tells the server
// which code brought them. The server decides whether it counts; this only carries it. See ADR-0071.
const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';

export default function ReferralBridge() {
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);

  useEffect(() => {
    try {
      const seen = rememberReferral(window.localStorage, window.location.search);
      if (seen) {
        const query = seen.search ? `?${seen.search}` : '';
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${query}${window.location.hash}`);
      }
    } catch { /* storage or history blocked */ }
  }, []);

  useEffect(() => {
    if (!account) return;
    let code = null;
    try { code = recallReferral(window.localStorage); } catch { return; }
    if (!code) return;
    gatewayFetch('/referrals/attach', { method: 'POST', body: JSON.stringify({ code }) })
      .then(() => forgetReferral(window.localStorage))
      .catch((err) => { if (attachIsFinal(err)) forgetReferral(window.localStorage); });
  }, [account]);

  return null;
}
