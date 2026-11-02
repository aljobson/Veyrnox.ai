'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { AccountBoundary } from '../../../_components/AccountBoundary';
import { Chip } from '../../../_components/Chip';
import { MfaPanel } from '../../../_components/MfaPanel';
import { gatewayFetch } from '../../../_lib/gateway';
import { adminMetricsState } from '../../../_lib/adminMetricsState';
import { AdminTabs } from '../_components/AdminTabs';
import { CHANGE_AREAS, changesQuery } from '../../../../../lib/adminChangesQuery';

const EMPTY = { area: '', actor: '', from: '', to: '' };
const control = 'min-h-11 rounded-xl border border-vx-border bg-vx-panel px-4 py-2 text-vx-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent';
const button = `${control} disabled:opacity-50 disabled:cursor-not-allowed`;
const COPY = {
  loading: 'Loading changes…',
  mfa: 'Verify your authenticator below, then retry Changes.',
  access: 'Complete your Cloudflare Access sign-in, then retry Changes.',
  forbidden: 'This account is not an administrator.',
  permission: 'Your administrator role cannot read Changes. Return to operations or ask an owner.',
  unauthenticated: 'Sign in with an administrator account to view Changes. Your filters are kept on this page.',
  unverified: 'Administrator access could not be verified. Check your sign-in, then retry.',
  unavailable: 'Changes are not configured or the service is unavailable. Retry after the service is restored.',
  error: 'Changes could not be loaded. Please retry.',
};
const when = value => new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC');

function search(filters, cursor = null) {
  const params = new URLSearchParams({ limit: '50' });
  for (const key of ['area', 'actor']) if (filters[key].trim()) params.set(key, filters[key].trim());
  // The labelled date window is UTC; the upper bound is exclusive.
  for (const key of ['from', 'to']) if (filters[key]) params.set(key, `${filters[key]}T00:00:00Z`);
  if (cursor) params.set('before', JSON.stringify(cursor));
  return params;
}

export default function Page() {
  return <><AppNav /><Main><AccountBoundary><Changes /></AccountBoundary></Main></>;
}

function Changes() {
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');
  const [offline, setOffline] = useState(false);
  const [slow, setSlow] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [cursor, setCursor] = useState(null);
  const [verified, setVerified] = useState(false);
  const request = useRef(0);

  const load = useCallback(async (queryFilters = EMPTY, before = null) => {
    if (!navigator.onLine) { setOffline(true); setState('error'); return; }
    const version = ++request.current;
    setState('loading');
    setSlow(false);
    const timer = setTimeout(() => { if (version === request.current) setSlow(true); }, 3000);
    try {
      const result = await gatewayFetch(`/admin/changes?${search(queryFilters, before)}`);
      if (version !== request.current) return;
      setVerified(true);
      setData(result);
      setApplied(queryFilters);
      setCursor(before);
      setState('ready');
    } catch (error) {
      if (version !== request.current) return;
      // Clear privileged data when access or the session is lost; retain the
      // last successful page on network failure so offline reads still work.
      if (error.status === 401 || error.status === 403) { setData(null); setVerified(false); }
      setState(error.code === 'permission_denied' ? 'permission' : error.status === 503 ? 'unavailable' : adminMetricsState(error));
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const sequence = request;
    const online = () => setOffline(false);
    const disconnected = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', disconnected);
    Promise.resolve().then(() => { if (active) { setOffline(!navigator.onLine); load(); } });
    return () => {
      active = false; sequence.current++;
      window.removeEventListener('online', online);
      window.removeEventListener('offline', disconnected);
    };
  }, [load]);

  const validate = (next = filters) => {
    const errors = {};
    if (next.actor.length > 320 || /[\x00-\x1f\x7f]/.test(next.actor)) errors.actor = 'Use an actor name or email of at most 320 characters, without control characters.';
    if (next.from && next.to && next.from >= next.to) errors.to = 'The end date must be after the start date.';
    if (changesQuery(search(next)).error && !Object.keys(errors).length) errors.from = 'Enter valid dates for the UTC window.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };
  const submit = event => { event.preventDefault(); if (validate()) load(filters); };
  const clear = () => { setFilters(EMPTY); setFieldErrors({}); load(EMPTY); };
  const filtered = Object.values(applied).some(Boolean);
  const busy = state === 'loading';

  return <section className="mx-auto max-w-5xl px-4 py-8 pb-32 text-vx-fg sm:px-8">
    <Link href="/app/admin" className="inline-flex min-h-11 items-center text-vx-accent underline focus-visible:outline-2 focus-visible:outline-vx-accent">Back to operations</Link>
    <div className="mt-4"><Chip>ADMIN</Chip></div>
    <h1 className="mt-3 font-vx text-3xl font-bold">Changes</h1>
    <p className="mt-3 text-vx-fg-body">Account actions and administrator changes, newest first. This log is read-only.</p>
    <AdminTabs isAdmin={verified} permissions={data?.permissions || []} />
    <MfaPanel onVerified={() => load(applied, cursor)} />
    {offline && <p role="status" className="mt-4 text-vx-fg-body">You are offline. Previously loaded changes remain readable. Reconnect to search or refresh.</p>}
    <form onSubmit={submit} className="mt-8 grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2">Area
        <select className={control} value={filters.area} onChange={e => setFilters({ ...filters, area: e.target.value })}>
          <option value="">All areas</option>
          {CHANGE_AREAS.map(area => <option key={area} value={area}>{area[0].toUpperCase() + area.slice(1)}</option>)}
        </select>
      </label>
      <label className="grid gap-2">Actor (exact name or email)
        <input className={control} value={filters.actor} maxLength={320} onChange={e => setFilters({ ...filters, actor: e.target.value })}
          onBlur={() => validate()} aria-invalid={!!fieldErrors.actor} aria-describedby={fieldErrors.actor ? 'actor-error' : undefined} />
        {fieldErrors.actor && <span id="actor-error" className="text-vx-danger">{fieldErrors.actor}</span>}
      </label>
      {[['from', 'From date (UTC, inclusive)'], ['to', 'Before date (UTC, exclusive)']].map(([key, label]) => <label key={key} className="grid gap-2">{label}
        <input type="date" className={control} value={filters[key]} onChange={e => setFilters({ ...filters, [key]: e.target.value })}
          onBlur={() => validate()} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `${key}-error` : undefined} />
        {fieldErrors[key] && <span id={`${key}-error`} className="text-vx-danger">{fieldErrors[key]}</span>}
      </label>)}
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button type="submit" className={`${button} min-h-13 border-vx-accent text-vx-accent`} disabled={busy || offline}>Apply filters</button>
        <button type="button" className={button} onClick={clear} disabled={busy || offline}>Clear filters</button>
      </div>
    </form>
    <div className="mt-6" aria-live="polite" aria-atomic="true">
      {state === 'ready' ? <p>{data.entries.length} changes loaded{filtered ? ` for ${[applied.area, applied.actor, applied.from && `from ${applied.from}`, applied.to && `before ${applied.to}`].filter(Boolean).join(', ')}` : ''}.</p>
        : <p role={busy ? 'status' : 'alert'} className={busy ? 'text-vx-fg-muted' : 'text-vx-danger'}>{slow && busy ? 'Still fetching the next page of the change log…' : COPY[state]}</p>}
    </div>
    {!busy && state !== 'ready' && <button type="button" className={`${button} mt-3`} disabled={offline} onClick={() => load(applied, cursor)}>Retry changes</button>}
    {state === 'unauthenticated' && <button type="button" className={`${button} mt-3`} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required', { detail: { mode: 'sign_in' } }))}>Sign in</button>}
    <div aria-busy={busy} className="mt-6 min-h-48">
      {busy && !data && <div aria-hidden="true" className="space-y-4">{[1, 2, 3].map(n => <div key={n} className="h-24 rounded-xl border border-vx-border bg-vx-panel" />)}</div>}
      {data && data.entries.length === 0 && <div className="rounded-xl border border-vx-border bg-vx-panel p-6">
        <h2 className="text-lg font-bold">{filtered ? 'No matching changes' : 'No changes recorded yet'}</h2>
        <p className="mt-2 text-vx-fg-body">{filtered ? 'Try a wider date window or another actor. Clear filters to see all changes.' : 'Recorded account actions and administrator changes will appear here. Refresh after an action has been recorded.'}</p>
        <button type="button" onClick={filtered ? clear : () => load(applied, cursor)} disabled={busy || offline} className={`${button} mt-4`}>{filtered ? 'Show all changes' : 'Refresh changes'}</button>
      </div>}
      {data && <ol className="space-y-4">{data.entries.map(entry => <li key={`${entry.area}:${entry.id}`} className="rounded-xl border border-vx-border bg-vx-panel p-5 break-words">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-bold">{entry.area} · {entry.action}</h2>
          <time dateTime={entry.created_at} className="text-xs text-vx-fg-muted">{when(entry.created_at)}</time>
        </div>
        <p className="mt-2 text-sm">Actor: {entry.actor}</p>
        <p className="mt-2 text-sm">Subject: {entry.subject_email || entry.subject}</p>
        <p className="mt-3 whitespace-pre-wrap text-vx-fg-body">{entry.reason}</p>
        {(entry.before !== null || entry.after !== null) && <details className="mt-4">
          <summary className="min-h-11 cursor-pointer py-2 text-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent">Before and after</summary>
          <dl className="grid gap-3 sm:grid-cols-2">{['before', 'after'].map(key => <div key={key}>
            <dt className="font-bold">{key === 'before' ? 'Before' : 'After'}</dt>
            <dd className="mt-2 whitespace-pre-wrap break-all font-vx-mono text-xs">{JSON.stringify(entry[key], null, 2)}</dd>
          </div>)}</dl>
        </details>}
      </li>)}</ol>}
    </div>
    {data && <div className="mt-6 flex flex-wrap gap-3">
      {cursor && <button type="button" className={button} disabled={busy || offline} onClick={() => load(applied)}>Newest changes</button>}
      {data.next_cursor && <button type="button" className={button} disabled={busy || offline} onClick={() => load(applied, data.next_cursor)}>Older changes</button>}
    </div>}
  </section>;
}
