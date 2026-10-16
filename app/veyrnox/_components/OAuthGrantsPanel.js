'use client';

import { useCallback, useEffect, useState } from 'react';
import { listOAuthGrants, revokeOAuthGrant } from '../../lib/authClient';
import { ConfirmDialog } from './ConfirmDialog';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';

function normaliseGrant(grant) {
  const client = grant?.client || {};
  const clientId = client.id || grant?.client_id || '';
  return {
    clientId,
    name: client.name || grant?.client_name || 'Connected assistant',
    uri: client.uri || grant?.client_uri || '',
    scopes: Array.isArray(grant?.scopes) ? grant.scopes : [],
    grantedAt: grant?.granted_at || grant?.created_at || '',
  };
}

function safeWebsite(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export function OAuthGrantsPanel() {
  const [grants, setGrants] = useState([]);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setState('loading');
    setMessage('');
    try {
      const data = await listOAuthGrants();
      const raw = Array.isArray(data) ? data : (Array.isArray(data?.grants) ? data.grants : []);
      setGrants(raw.map(normaliseGrant).filter((grant) => grant.clientId));
      setState('ready');
    } catch {
      setMessage('Connected assistants could not be loaded. Try again.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function revoke() {
    const grant = selected;
    setSelected(null);
    if (!grant) return;
    setState('revoking');
    setMessage('');
    try {
      await revokeOAuthGrant(grant.clientId);
      setGrants((current) => current.filter((item) => item.clientId !== grant.clientId));
      setMessage(`${grant.name} no longer has access.`);
      setState('ready');
    } catch {
      setMessage('That connection could not be revoked. Try again.');
      setState('error');
    }
  }

  return <section className="rounded-2xl border border-vx-border p-5" aria-labelledby="connected-assistants-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="connected-assistants-heading" className="font-bold mb-2">Connected assistants</h2>
        <p className="text-sm text-vx-fg-muted">Review and revoke apps connected through Veyrnox OAuth. Revoking also ends that client’s active sessions.</p>
      </div>
      <button type="button" disabled={state === 'loading' || state === 'revoking'} className={button} onClick={load}>Refresh</button>
    </div>

    {state === 'loading' && <p role="status" className="mt-4 text-sm text-vx-fg-muted">Loading connections…</p>}
    {state !== 'loading' && grants.length === 0 && state !== 'error' && <p className="mt-4 text-sm text-vx-fg-body">No assistants are connected.</p>}
    {grants.length > 0 && <ul className="mt-4 divide-y divide-vx-border border-y border-vx-border">
      {grants.map((grant) => {
        const website = safeWebsite(grant.uri);
        return <li key={grant.clientId} className="py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-extrabold text-vx-fg">{grant.name}</p>
            <p className="mt-1 text-xs text-vx-fg-muted">
              {grant.scopes.length ? `Access: ${grant.scopes.join(', ')}` : 'Read-only Veyrnox access'}
              {grant.grantedAt ? ` · Connected ${new Date(grant.grantedAt).toLocaleDateString()}` : ''}
            </p>
            {website && <a className="mt-1 block truncate text-xs underline text-vx-fg-body" href={website} rel="noreferrer" target="_blank">{website}</a>}
          </div>
          <button type="button" disabled={state === 'revoking'} className={button} onClick={() => setSelected(grant)}>Revoke access</button>
        </li>;
      })}
    </ul>}
    {message && <p role={state === 'error' ? 'alert' : 'status'} className={`mt-4 text-sm ${state === 'error' ? 'text-vx-danger' : 'text-vx-accent'}`}>{message}</p>}
    {selected && <ConfirmDialog title={`Revoke ${selected.name}?`} body="The assistant will be signed out and must ask for approval again before it can read your Veyrnox data." confirmLabel="Revoke access" onCancel={() => setSelected(null)} onConfirm={revoke} />}
  </section>;
}
