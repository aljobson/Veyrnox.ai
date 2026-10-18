'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getSession, getOAuthAuthorizationDetails, onSessionChange, respondToOAuthAuthorization } from '../../../lib/authClient';

function fields(details) {
  const client = details?.client || details?.client_metadata || {};
  const rawScope = details?.scope || details?.scopes || details?.requested_scopes || [];
  const scopes = Array.isArray(rawScope) ? rawScope : String(rawScope || '').split(/\s+/).filter(Boolean);
  return {
    name: client.client_name || client.name || details?.client_name || 'An MCP assistant',
    uri: client.client_uri || client.uri || details?.client_uri || '',
    redirect: details?.redirect_uri || '',
    scopes,
  };
}

const signedInSnapshot = () => Boolean(getSession());
const signedOutServerSnapshot = () => false;

export function OAuthConsent({ authorizationId, publishOpen = false }) {
  const signedIn = useSyncExternalStore(onSessionChange, signedInSnapshot, signedOutServerSnapshot);
  const [details, setDetails] = useState(null);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!authorizationId || !signedIn) return undefined;
    getOAuthAuthorizationDetails(authorizationId).then((data) => {
      if (!cancelled) { setDetails(data); setState('ready'); }
    }).catch((error) => {
      if (!cancelled) { setMessage(error?.message || 'This connection request is no longer available.'); setState('error'); }
    });
    return () => { cancelled = true; };
  }, [authorizationId, signedIn]);

  const decide = useCallback(async (action) => {
    setState(action === 'approve' ? 'approving' : 'denying');
    setMessage('');
    try {
      const result = await respondToOAuthAuthorization(authorizationId, action);
      const redirect = result?.redirect_url || result?.redirect_uri;
      if (!redirect) throw new Error('The authorization server did not return a redirect.');
      window.location.assign(redirect);
    } catch (error) {
      setMessage(error?.message || 'The connection decision could not be saved.');
      setState('ready');
    }
  }, [authorizationId]);

  if (!authorizationId) return <Panel title="Invalid connection request"><p className="text-vx-fg-body">This page needs an authorization request from a supported MCP client.</p></Panel>;
  if (!signedIn) {
    return <Panel title="Sign in to connect"><p className="text-vx-fg-body leading-[1.6]">Sign in to the Veyrnox account you want this assistant to use. You will return here to review the connection.</p><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required', { detail: { mode: 'sign_in', returnTo: window.location.pathname + window.location.search } }))} className="mt-7 rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 font-extrabold hover:bg-vx-accent-hover">Sign in</button></Panel>;
  }
  if (state === 'loading') return <Panel><p className="text-vx-fg-body">Loading the connection request…</p></Panel>;
  if (state === 'error') return <Panel title="Connection unavailable"><p role="alert" className="text-vx-danger">{message}</p></Panel>;

  const shown = fields(details);
  const busy = state === 'approving' || state === 'denying';
  return (
    <Panel>
      <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] uppercase text-vx-accent">OAuth connection</p>
      <h1 className="vx-display mt-4 text-[40px] sm:text-[52px] leading-[1]">Connect {shown.name}?</h1>
      <p className="mt-5 text-vx-fg-body leading-[1.65]">{publishOpen ? 'This assistant will receive Veyrnox access until you revoke the connection. It can read your account and, with a Publish Plan, schedule, move and cancel posts on your connected accounts.' : 'This assistant will receive read-only Veyrnox access until you revoke the connection.'}</p>
      <div className="mt-7 rounded-2xl border border-vx-border bg-vx-base p-5">
        <h2 className="font-extrabold">Requested access</h2>
        <ul className="mt-3 space-y-2 text-sm text-vx-fg-body">
          <li>View models, generation history and credit balance</li>
          <li>Estimate generation costs without starting or charging for a generation</li>
          <li>Retrieve short-lived links to your finished assets</li>
          {publishOpen && <li>View your connected accounts, scheduled and published posts and analytics, and schedule, reschedule or cancel posts (Publish Plan). It cannot publish immediately.</li>}
        </ul>
        {shown.scopes.length > 0 && <p className="mt-4 font-vx-mono text-[11px] text-vx-fg-muted">Scopes: {shown.scopes.join(' · ')}</p>}
      </div>
      <p className="mt-5 text-sm leading-[1.55] text-vx-fg-muted">Veyrnox does not share your password. {publishOpen ? 'This connection cannot start generations, change your account settings, spend credits or publish immediately.' : 'This connection cannot start generations, change your account or spend credits.'} You can revoke it from Account &amp; security.</p>
      {message && <p role="alert" className="mt-5 text-sm text-vx-danger">{message}</p>}
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => decide('approve')} className="rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 font-extrabold hover:bg-vx-accent-hover disabled:opacity-50">{state === 'approving' ? 'Connecting…' : 'Approve connection'}</button>
        <button type="button" disabled={busy} onClick={() => decide('deny')} className="rounded-full border border-vx-border px-6 py-3 font-extrabold text-vx-fg-body hover:border-vx-fg disabled:opacity-50">{state === 'denying' ? 'Declining…' : 'Deny'}</button>
      </div>
      {(shown.uri || shown.redirect) && <details className="mt-7 text-xs text-vx-fg-muted"><summary className="cursor-pointer font-bold">Technical details</summary><div className="mt-3 space-y-2 break-all">{shown.uri && <p>Client: {shown.uri}</p>}{shown.redirect && <p>Return URL: {shown.redirect}</p>}</div></details>}
    </Panel>
  );
}

function Panel({ title, children }) {
  return <div className="rounded-[28px] border border-vx-border bg-vx-panel p-6 sm:p-9">{title && <h1 className="vx-display text-[40px] sm:text-[52px] leading-[1] mb-5">{title}</h1>}{children}</div>;
}
