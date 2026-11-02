'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Chip } from '../../../_components/Chip';
import { AccountBoundary } from '../../../_components/AccountBoundary';
import { MfaPanel } from '../../../_components/MfaPanel';
import { gatewayFetch } from '../../../_lib/gateway';
import { adminMetricsState } from '../../../_lib/adminMetricsState';
import { AdminTabs } from './AdminTabs';

export const adminControl = 'min-h-11 rounded-xl border border-vx-border bg-vx-panel px-4 py-2 text-vx-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent disabled:opacity-50';
export const adminWhen = value => value ? new Date(value).toISOString().replace('T',' ').replace('Z',' UTC') : '—';
// Display a recorded cent value, never derive a price from a plan or credit amount.
export const adminUsd = cents => '$' + (Number(cents || 0) / 100).toFixed(2);
const COPY = {
  mfa: 'Verify your authenticator below, then retry.',
  access: 'Complete your Cloudflare Access sign-in, then retry.',
  forbidden: 'This account is not an administrator.',
  permission: 'Your administrator role cannot open this section. Return to operations or ask an owner.',
  unauthenticated: 'Sign in again to continue. Your unsent input is kept here.',
  unverified: 'Administrator access could not be verified. Check your sign-in and retry.',
  unavailable: 'This section is not configured or the service is unavailable. Retry after it is restored.',
  error: 'The section could not be loaded. Please retry.',
};
export function adminError(error) {
  return COPY[error.code === 'permission_denied' ? 'permission' : error.status === 503 ? 'unavailable' : adminMetricsState(error)] || COPY.error;
}
export function AdminPanel(props) {
  return <AccountBoundary><Panel {...props} /></AccountBoundary>;
}
function Panel({ title, endpoint, children, description }) {
  const [data, setData] = useState(null), [error, setError] = useState(null);
  const [loading, setLoading] = useState(true), [slow, setSlow] = useState(false), [offline, setOffline] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    if (!navigator.onLine) { setOffline(true); setLoading(false); return; }
    const version = ++sequence.current;
    setLoading(true); setError(null); setSlow(false);
    const timer = setTimeout(() => { if (sequence.current === version) setSlow(true); }, 3000);
    try {
      const result = await gatewayFetch(endpoint);
      if (sequence.current === version) setData(result);
    } catch (failure) {
      if (sequence.current === version) {
        setError(failure);
      }
    } finally { clearTimeout(timer); if (sequence.current === version) setLoading(false); }
  }, [endpoint]);
  useEffect(() => {
    let active = true;
    const requests = sequence;
    const connected = () => setOffline(!navigator.onLine);
    window.addEventListener('online', connected); window.addEventListener('offline', connected);
    Promise.resolve().then(() => { if (active) { connected(); load(); } });
    return () => { active = false; requests.current++; window.removeEventListener('online', connected); window.removeEventListener('offline', connected); };
  }, [load]);
  return <section className="mx-auto max-w-6xl px-4 py-8 pb-32 text-vx-fg sm:px-8">
    <Link href="/app/admin" className="inline-flex min-h-11 items-center text-vx-accent underline focus-visible:outline-2 focus-visible:outline-vx-accent">Back to operations</Link>
    <div className="mt-4"><Chip>ADMIN</Chip></div>
    <h1 className="mt-3 font-vx text-3xl font-bold">{title}</h1>
    <p className="mt-3 text-vx-fg-body">{description}</p>
    <AdminTabs isAdmin={!!data && ![401,403].includes(error?.status)} permissions={data?.permissions || []} />
    <MfaPanel onVerified={load} />
    {offline && <p role="status" className="mt-4">You are offline. Loaded data remains readable; reconnect to refresh or save.</p>}
    <div aria-live="polite" className="mt-4">
      {loading && <p role="status">{slow ? 'Still fetching this section from the database…' : 'Loading section…'}</p>}
      {error && <p role="alert" className="text-vx-danger">{adminError(error)}</p>}
      {!loading && !error && data && <p role="status">Section loaded.</p>}
    </div>
    <button type="button" className={adminControl + ' mt-4'} onClick={load} disabled={loading || offline}>{error ? 'Retry' : 'Refresh'}</button>
    {error?.status === 401 && <button type="button" className={adminControl + ' ml-3'} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required', { detail: { mode: 'sign_in' } }))}>Sign in</button>}
    <div hidden={[401,403].includes(error?.status)} aria-busy={loading} className="mt-8 min-h-48">
      {loading && !data && <div aria-hidden="true" className="h-48 rounded-xl border border-vx-border bg-vx-panel" />}
      {data && <PanelContent render={children} data={data} onRefresh={load} offline={offline} />}
    </div>
  </section>;
}
function PanelContent({ render, data, onRefresh, offline }) { return render(data, onRefresh, offline); }
export function AdminTable({ title, rows, columns, empty = 'No records in this window. Refresh later or try a wider window.' }) {
  return <section className="mt-8">
    <h2 className="mb-3 font-vx text-xl font-bold">{title}</h2>
    {!rows.length ? <p className="rounded-xl border border-vx-border p-5 text-vx-fg-muted">{empty}</p>
      : <div className="max-w-full overflow-x-auto rounded-xl border border-vx-border" tabIndex={0} role="region" aria-label={title}>
        <table className="w-full text-left text-sm"><thead><tr>{columns.map(c => <th key={c.key} scope="col" className="border-b border-vx-border p-3">{c.label}</th>)}</tr></thead>
          <tbody>{rows.map((row, i) => <tr key={row.id || row.user_id || i}>{columns.map(c => <td key={c.key} className="border-b border-vx-border p-3 break-words">{c.render ? c.render(row[c.key], row) : String(row[c.key] ?? '—')}</td>)}</tr>)}</tbody>
        </table>
      </div>}
  </section>;
}
