'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../../_components/NavBar';
import { AccountBoundary } from '../../../../_components/AccountBoundary';
import { MfaPanel } from '../../../../_components/MfaPanel';
import { Button } from '../../../../_components/Button';
import { gatewayFetch } from '../../../../_lib/gateway';

export default function Page() {
  return <><AppNav /><AccountBoundary><Queue /></AccountBoundary></>;
}
const labels = { FILM: 'Film', SHORT: 'Short', TRAILER: 'Trailer', SERIES: 'Series' };
const minutes = (s) => `${Math.round((s || 0) / 60)} min`;

function Queue() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setBusy(true); setError(''); setLoaded(false); setItems([]);
    try {
      const data = await gatewayFetch('/admin/cinema/submissions');
      if (version === generation.current) { setItems(data.submissions); setLoaded(true); }
    } catch (e) { if (version === generation.current) setError(message(e.code)); }
    finally { if (version === generation.current) setBusy(false); }
  }, []);
  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);
  return <main id="main" className="mx-auto max-w-3xl px-4 py-10 pb-32 sm:px-8">
    <Link href="/app/admin" className="text-sm underline">Back to operations</Link>
    <h1 className="mt-5 text-3xl font-black">Cinema publication queue</h1>
    <p className="my-5 text-vx-fg-body">Review requires a Cinema administrator account and a fresh authenticator check. Approval publishes the whole title; rejection returns it to the creator as a draft with your note.</p>
    <MfaPanel requireFresh onVerified={load} />
    <Button className="mt-5" disabled={busy} onClick={load}>{busy ? 'Loading…' : 'Refresh queue'}</Button>
    {error && <p role="alert" className="mt-4">{error}</p>}
    {loaded && items.length === 0 && <p role="status" className="mt-6">Nothing is waiting for review.</p>}
    {items.map((item) => <Submission key={item.id} item={item} onDone={load} />)}
    {items.length === 50 && <p className="mt-5 text-sm">Showing the oldest 50 submissions. Refresh after reviewing to load more.</p>}
    <Suspend onDone={load} />
  </main>;
}

function Submission({ item, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef(null);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const note = form.get('creator_note').trim();
    const body = JSON.stringify({ submission_id: item.id, decision: form.get('decision'), reason: form.get('reason').trim(), ...(note ? { creator_note: note } : {}) });
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try { await gatewayFetch('/admin/cinema/submissions', { method: 'POST', body, headers: { 'idempotency-key': attempt.current.key } }); onDone(); }
    catch (e) { setError(message(e.code)); setBusy(false); }
  }
  return <article className="mt-6 rounded-2xl border border-vx-border p-5">
    <p className="font-vx-mono text-xs text-vx-fg-muted">{labels[item.content_type]} · {item.language} · {item.content_type === 'SERIES' ? `${item.episode_count} episodes · ` : ''}{minutes(item.duration_seconds)} · {(item.categories || []).join(', ') || 'no category'} · rights {item.rights_version}{item.prior_actions > 0 ? ` · ${item.prior_actions} prior action(s)` : ''}</p>
    <h2 className="mt-2 text-xl font-bold break-words">{item.title}</h2>
    <p className="text-vx-fg-muted">{item.display_name} <span>@{item.username}</span></p>
    <p className="mt-4 whitespace-pre-wrap break-words text-vx-fg-body">{item.synopsis || 'No synopsis.'}</p>
    {item.ai_disclosures?.length > 0 && <p className="mt-3 text-sm text-vx-fg-muted">AI disclosures: {item.ai_disclosures.join(', ')}</p>}
    <form onSubmit={submit} className="mt-5 space-y-4">
      <label className="block">Decision<select name="decision" required className="ml-3 rounded-lg bg-vx-panel p-2"><option value="">Choose…</option><option value="approved">Approve and publish</option><option value="rejected">Reject</option></select></label>
      <label className="block">Internal review reason<textarea name="reason" required minLength={3} maxLength={500} rows={2} className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3" /></label>
      <label className="block">Note to the creator <span className="text-vx-fg-muted">(shown on rejection, optional)</span><textarea name="creator_note" maxLength={500} rows={2} className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3" /></label>
      <p className="text-xs text-vx-fg-muted">Both are recorded in the audit history. Do not include identity documents or other sensitive details.</p>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save decision'}</Button>
    </form>
  </article>;
}

function Suspend({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const attempt = useRef(null);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = JSON.stringify({ content_id: form.get('content_id').trim().toLowerCase(), reason: form.get('reason').trim() });
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    if (!window.confirm('Suspend this title? It leaves the catalogue at once, its creator cannot edit or resubmit it, and every Unlock from the last 30 days is refunded in credits.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await gatewayFetch('/admin/cinema/suspend', { method: 'POST', body, headers: { 'idempotency-key': attempt.current.key } });
      setNotice(`Suspended. ${r.unlocks_reversed} Unlock(s) reversed, ${r.credits_returned} credits returned.`);
      event.target.reset(); onDone();
    } catch (e) { setError(message(e.code)); } finally { setBusy(false); }
  }
  return <section className="mt-12 rounded-2xl border border-vx-danger/40 p-5" aria-labelledby="suspend-title">
    <h2 id="suspend-title" className="text-xl font-bold">Suspend a published title</h2>
    <p className="mt-2 text-sm text-vx-fg-body">A Suspension: the title leaves Social Cinema for good. The title id is on its public page URL.</p>
    <form onSubmit={submit} className="mt-4 space-y-4">
      <label className="block">Title id<input name="content_id" required pattern="[0-9a-fA-F-]{36}" className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3 font-vx-mono" /></label>
      <label className="block">Reason<textarea name="reason" required minLength={3} maxLength={500} rows={2} className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3" /></label>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Button type="submit" variant="secondary" disabled={busy}>{busy ? 'Suspending…' : 'Suspend title'}</Button>
    </form>
  </section>;
}

function message(code) {
  return ({ no_token: 'Sign in with your Cinema administrator account.', unauthenticated: 'Sign in with your Cinema administrator account.', recent_mfa_required: 'Enter a fresh authenticator code above, then try again.', not_authorized: 'This account does not have Cinema publication permission.', access_required: 'Open this page through the protected Veyrnox administrator site.', publishing_not_open: 'Publication is not open yet.', already_reviewed: 'Another reviewer has already decided this submission. Refresh the queue.', self_review_forbidden: 'You cannot review your own title.', account_not_active: 'The creator account is no longer eligible.', content_not_found: 'No title with that id.', already_suspended: 'That title is already suspended.', rate_limited: 'Too many requests. Wait a minute and try again.' })[code] || 'The queue is unavailable right now. Please retry.';
}
