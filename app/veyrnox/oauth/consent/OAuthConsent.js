'use client';
import { useI18n } from '../../../../components/I18nProvider';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getSession, getOAuthAuthorizationDetails, onSessionChange, respondToOAuthAuthorization } from '../../../lib/authClient';

function fields(details, t) {
  const client = details?.client || details?.client_metadata || {};
  const rawScope = details?.scope || details?.scopes || details?.requested_scopes || [];
  const scopes = Array.isArray(rawScope) ? rawScope : String(rawScope || '').split(/\s+/).filter(Boolean);
  return {
    name: client.client_name || client.name || details?.client_name || t('oauth.assistant'),
    uri: client.client_uri || client.uri || details?.client_uri || '',
    redirect: details?.redirect_uri || '',
    scopes,
  };
}

const signedInSnapshot = () => Boolean(getSession());
const signedOutServerSnapshot = () => false;

export function OAuthConsent({ authorizationId, publishOpen = false }) {
  const { t } = useI18n();
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
      if (!cancelled) { setMessage(error?.message || t('oauth.unavailable')); setState('error'); }
    });
    return () => { cancelled = true; };
  }, [authorizationId, signedIn, t]);

  const decide = useCallback(async (action) => {
    setState(action === 'approve' ? 'approving' : 'denying');
    setMessage('');
    try {
      const result = await respondToOAuthAuthorization(authorizationId, action);
      const redirect = result?.redirect_url || result?.redirect_uri;
      if (!redirect) throw new Error(t('oauth.noRedirect'));
      window.location.assign(redirect);
    } catch (error) {
      setMessage(error?.message || t('oauth.saveError'));
      setState('ready');
    }
  }, [authorizationId, t]);

  if (!authorizationId) return <Panel title={t('oauth.invalid')}><p className="text-vx-fg-body">{t('oauth.needsRequest')}</p></Panel>;
  if (!signedIn) {
    return <Panel title={t('oauth.signInTitle')}><p className="text-vx-fg-body leading-[1.6]">{t('oauth.signInBody')}</p><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required', { detail: { mode: 'sign_in', returnTo: window.location.pathname + window.location.search } }))} className="mt-7 rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 font-extrabold hover:bg-vx-accent-hover">{t('oauth.signIn')}</button></Panel>;
  }
  if (state === 'loading') return <Panel><p className="text-vx-fg-body">{t('oauth.loading')}</p></Panel>;
  if (state === 'error') return <Panel title={t('oauth.errorTitle')}><p role="alert" className="text-vx-danger">{message}</p></Panel>;

  const shown = fields(details, t);
  const busy = state === 'approving' || state === 'denying';
  return (
    <Panel>
      <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] uppercase text-vx-accent">{t('oauth.connection')}</p>
      <h1 className="vx-display mt-4 text-[40px] sm:text-[52px] leading-[1]">{t('oauth.connectName', { name: shown.name })}</h1>
      <p className="mt-5 text-vx-fg-body leading-[1.65]">{publishOpen ? t('oauth.summaryPublish') : t('oauth.summary')}</p>
      <div className="mt-7 rounded-2xl border border-vx-border bg-vx-base p-5">
        <h2 className="font-extrabold">{t('oauth.access')}</h2>
        <ul className="mt-3 space-y-2 text-sm text-vx-fg-body">
          <li>{t('oauth.models')}</li>
          <li>{t('oauth.estimate')}</li>
          <li>{t('oauth.limit')}</li>
          <li>{t('oauth.video')}</li>
          <li>{t('oauth.assets')}</li>
          {publishOpen && <li>{t('oauth.publishAccess')}</li>}
        </ul>
        {shown.scopes.length > 0 && <p className="mt-4 font-vx-mono text-[11px] text-vx-fg-muted">{t('oauth.scopes')} {shown.scopes.join(' · ')}</p>}
      </div>
      <p className="mt-5 text-sm leading-[1.55] text-vx-fg-muted">{t('oauth.password')} {publishOpen ? t('oauth.restrictionsPublish') : t('oauth.restrictions')}  {t('oauth.revoke')}</p>
      {message && <p role="alert" className="mt-5 text-sm text-vx-danger">{message}</p>}
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => decide('approve')} className="rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 font-extrabold hover:bg-vx-accent-hover disabled:opacity-50">{state === 'approving' ? t('oauth.connecting') : t('oauth.approve')}</button>
        <button type="button" disabled={busy} onClick={() => decide('deny')} className="rounded-full border border-vx-border px-6 py-3 font-extrabold text-vx-fg-body hover:border-vx-fg disabled:opacity-50">{state === 'denying' ? t('oauth.declining') : t('oauth.deny')}</button>
      </div>
      {(shown.uri || shown.redirect) && <details className="mt-7 text-xs text-vx-fg-muted"><summary className="cursor-pointer font-bold">{t('oauth.technical')}</summary><div className="mt-3 space-y-2 break-all">{shown.uri && <p>{t('oauth.client')} {shown.uri}</p>}{shown.redirect && <p>{t('oauth.returnUrl')} {shown.redirect}</p>}</div></details>}
    </Panel>
  );
}

function Panel({ title, children }) {
  return <div className="rounded-[28px] border border-vx-border bg-vx-panel p-6 sm:p-9">{title && <h1 className="vx-display text-[40px] sm:text-[52px] leading-[1] mb-5">{title}</h1>}{children}</div>;
}
