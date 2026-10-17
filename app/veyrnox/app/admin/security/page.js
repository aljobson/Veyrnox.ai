'use client';

/**
 * Security alerts (ADR-0104): open alerts by severity, the alert list with its
 * ATT&CK tags and a triage control, and the latest raw security events.
 * Reads /api/v1/admin/security; a state change posts to
 * the same path.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { AccountBoundary } from '../../../_components/AccountBoundary';
import { MfaPanel } from '../../../_components/MfaPanel';
import { Button } from '../../../_components/Button';
import { Chip } from '../../../_components/Chip';
import { gatewayFetch } from '../../../_lib/gateway';

const nf = new Intl.NumberFormat('en-US');
const when = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];
const SEVERITY_TONE = { critical: 'danger', high: 'danger', medium: 'warn', low: 'accent', informational: 'accent' };
const STATES = [
  ['open', 'Open'], ['acknowledged', 'Acknowledged'], ['investigating', 'Investigating'],
  ['resolved', 'Resolved'], ['false_positive', 'False positive'],
];
const FILTERS = [['', 'Active'], ['open', 'Open'], ['resolved', 'Resolved'], ['false_positive', 'False positive']];
const ACTIVE = new Set(['open', 'acknowledged', 'investigating']);

export default function Page() {
  return <><AppNav /><Main><AccountBoundary><Security /></AccountBoundary></Main></>;
}

function Security() {
  const [filter, setFilter] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const load = useCallback(async (status) => {
    const version = ++generation.current;
    setError('');
    try {
      const d = await gatewayFetch(`/admin/security?limit=100${status ? `&status=${status}` : ''}`);
      if (version === generation.current) setData(d);
    } catch (e) {
      if (version === generation.current) { setData(null); setError(message(e.code)); }
    }
  }, []);

  // A request counter, not a DOM node: the cleanup must bump the live value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(filter); return () => { generation.current++; }; }, [load, filter]);

  const alerts = data ? data.alerts.filter((a) => filter || ACTIVE.has(a.status)) : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 pb-32 sm:px-8">
      <Link href="/app/admin" className="text-sm underline">Back to operations</Link>
      <Chip tone="danger" className="mt-5 mb-3">ADMIN · SECURITY</Chip>
      <h1 className="text-3xl font-black tracking-[-0.02em]">Security alerts</h1>
      <p className="my-5 text-vx-fg-body max-w-[640px]">
        Rules read the signals we already keep (webhook refusals, account freezes, refused sign-ins, admin access refusals)
        every five minutes and raise one alert per rule, source and hour. Tags are MITRE ATT&amp;CK techniques. Refused sign-ins and
        admin refusals are recorded when <code className="font-vx-mono text-xs">SECURITY_EVENTS_ENABLED</code> is true.
      </p>
      <MfaPanel />
      {data && <Summary counts={data.open_by_severity} />}
      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Alert state">
        {FILTERS.map(([value, label]) => (
          <Button key={value || 'active'} size="sm" variant={filter === value ? 'primary' : 'ghost'} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}>{label}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => load(filter)}>Refresh</Button>
      </div>
      {error && <p role="alert" className="mt-4 text-vx-danger">{error}</p>}
      {data && <Alerts rows={alerts} onChanged={() => load(filter)} />}
      {data && <Events rows={data.recent_events} />}
    </div>
  );
}

function Summary({ counts }) {
  return (
    <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-3">
      {SEVERITIES.map((s) => (
        <div key={s} className="rounded-[10px] border border-vx-border bg-vx-panel p-4">
          <div className="font-vx-mono text-[9.5px] tracking-[0.12em] text-vx-fg-muted">{s.toUpperCase()}</div>
          <div className={`mt-1 font-vx-mono text-[26px] font-bold vx-num ${counts[s] && (s === 'critical' || s === 'high') ? 'text-vx-danger' : ''}`}>{nf.format(counts[s] || 0)}</div>
        </div>
      ))}
    </div>
  );
}

function Alerts({ rows, onChanged }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-black tracking-[-0.02em] mb-3">Alerts</h2>
      <div className="rounded-[10px] border border-vx-border bg-vx-panel">
        {rows.length === 0 && <div className="px-5 py-4 text-sm text-vx-fg-muted">No alerts here.</div>}
        {rows.map((a) => <AlertRow key={a.id} alert={a} onChanged={onChanged} />)}
      </div>
    </section>
  );
}

function AlertRow({ alert, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  async function setStatus(status) {
    setBusy(true); setFailed('');
    try {
      await gatewayFetch('/admin/security', { method: 'POST', body: JSON.stringify({ alert_id: alert.id, status }) });
      onChanged();
    } catch (e) {
      setFailed(message(e.code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-4 border-b border-vx-border/60 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={SEVERITY_TONE[alert.severity]} noGlyph>{alert.severity}</Chip>
        <span className="font-vx-mono text-xs text-vx-fg-muted">{alert.rule_id}</span>
        <span className="font-bold">{alert.title}</span>
      </div>
      <div className="mt-1 text-sm text-vx-fg-body">
        <span className="font-vx-mono text-xs break-all">{alert.entity}</span> · {nf.format(alert.event_count)} event{alert.event_count === 1 ? '' : 's'} · first {when(alert.first_seen)} · last {when(alert.last_seen)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {alert.tags.map((t) => <Chip key={t} tone="accent" noGlyph>{t.replace('attack.', '')}</Chip>)}
        <label className="ml-auto flex items-center gap-2 text-xs">
          <span className="text-vx-fg-muted">State</span>
          <select className="rounded border border-vx-border bg-vx-panel px-2 py-1 text-sm" value={alert.status} disabled={busy} onChange={(e) => setStatus(e.target.value)} aria-label={`State of ${alert.rule_id} ${alert.entity}`}>
            {STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      {alert.updated_by && <div className="mt-1 text-xs text-vx-fg-muted">Last changed by {alert.updated_by} · {when(alert.updated_at)}</div>}
      {failed && <p role="alert" className="mt-2 text-sm text-vx-danger">{failed}</p>}
    </div>
  );
}

function Events({ rows }) {
  const cols = 'grid-cols-[150px_100px_190px_70px_1fr]';
  return (
    <section className="mt-10">
      <h2 className="text-lg font-black tracking-[-0.02em] mb-3">Latest security events</h2>
      <div className="rounded-[10px] border border-vx-border bg-vx-panel overflow-x-auto">
        <div className="min-w-[680px]">
          <div className={`grid ${cols} px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted`}>
            <div>WHEN</div><div>CATEGORY</div><div>ACTION</div><div className="text-right">STATUS</div><div className="pl-4">PATH · REASON</div>
          </div>
          {rows.length === 0 && <div className="px-5 py-4 text-sm text-vx-fg-muted">No events recorded yet.</div>}
          {rows.map((r, i) => (
            <div key={`${r.created_at}:${i}`} className={`grid ${cols} items-center px-5 py-2.5 border-b border-vx-border/60 last:border-b-0 text-sm`}>
              <div className="font-vx-mono text-xs">{when(r.created_at)}</div>
              <div className="font-bold">{r.category}</div>
              <div className="font-vx-mono text-xs">{r.action}</div>
              <div className="text-right font-vx-mono vx-num">{r.status ?? '—'}</div>
              <div className="pl-4 font-vx-mono text-xs break-all">{[r.path, r.reason].filter(Boolean).join(' · ') || '—'}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function message(code) {
  return ({
    no_token: 'Sign in with an administrator account.',
    unauthenticated: 'Sign in with an administrator account.',
    not_admin: 'This account is not an administrator.',
    mfa_required: 'Unlock this session with your authenticator above, then try again.',
    rate_limited: 'Too many requests. Wait a minute and try again.',
  })[code] || 'Security alerts are unavailable right now. Please retry.';
}
