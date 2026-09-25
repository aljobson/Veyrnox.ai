'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { AccountBoundary } from '../../../_components/AccountBoundary';
import { MfaPanel } from '../../../_components/MfaPanel';
import { Button } from '../../../_components/Button';
import { gatewayFetch } from '../../../_lib/gateway';

export default function Page() {
  return <><AppNav /><AccountBoundary><Reviews /></AccountBoundary></>;
}
function Reviews() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setBusy(true); setError(''); setLoaded(false); setItems([]);
    try {
      const data = await gatewayFetch('/admin/cinema/creators');
      if (version === generation.current) { setItems(data.applications); setLoaded(true); }
    } catch(e) { if (version === generation.current) setError(message(e.code)); }
    finally { if (version === generation.current) setBusy(false); }
  }, []);
  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);
  return <main id="main" className="mx-auto max-w-3xl px-4 py-10 pb-32 sm:px-8">
    <Link href="/app/admin" className="text-sm underline">Back to operations</Link>
    <h1 className="mt-5 text-3xl font-black">Cinema creator applications</h1>
    <p className="my-5 text-vx-fg-body">Review requires a Cinema administrator account and a fresh authenticator check. Approval grants a creator role only.</p>
    <MfaPanel requireFresh onVerified={load} />
    <Button className="mt-5" disabled={busy} onClick={load}>{busy ? 'Loading…' : 'Refresh applications'}</Button>
    {error && <p role="alert" className="mt-4">{error}</p>}
    {loaded && items.length === 0 && <p role="status" className="mt-6">No pending applications.</p>}
    {items.map(item => <Review key={item.id} item={item} onDone={load} />)}
    {items.length === 50 && <p className="mt-5 text-sm">Showing the oldest 50 pending applications. Refresh after reviewing to load more.</p>}
  </main>;
}
function Review({ item, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef(null);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = JSON.stringify({ application_id: item.id, decision: form.get('decision'), reason: form.get('reason').trim() });
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try { await gatewayFetch('/admin/cinema/creators', { method: 'POST', body, headers: { 'idempotency-key': attempt.current.key } }); onDone(); }
    catch(e) { setError(message(e.code)); setBusy(false); }
  }
  return <article className="mt-6 rounded-2xl border border-vx-border p-5">
    <h2 className="font-bold">{item.display_name} <span className="text-vx-fg-muted">@{item.username}</span></h2>
    <p className="mt-4 whitespace-pre-wrap break-words">{item.statement}</p>
    <form onSubmit={submit} className="mt-5 space-y-4">
      <label className="block">Decision<select name="decision" required className="ml-3 rounded-lg bg-vx-panel p-2"><option value="">Choose…</option><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
      <label className="block">Internal review reason<textarea name="reason" required minLength={3} maxLength={500} rows={2} className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3" /></label>
      <p className="text-xs text-vx-fg-muted">Recorded in the audit history. Do not include identity documents or other sensitive details.</p>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save decision'}</Button>
    </form>
  </article>;
}
function message(code) {
  return ({ recent_mfa_required: 'Enter a fresh authenticator code above, then try again.', not_authorized: 'This account does not have Cinema approval permission.', access_required: 'Open this page through the protected Veyrnox administrator site.', creators_not_open: 'Creator applications are not open yet.', already_reviewed: 'Another reviewer has already decided this application. Refresh the list.', self_review_forbidden: 'You cannot review your own application.', account_not_active: 'This account is no longer eligible for review.', rate_limited: 'Too many requests. Wait a minute and try again.' })[code] || 'Applications are unavailable right now. Please retry.';
}
