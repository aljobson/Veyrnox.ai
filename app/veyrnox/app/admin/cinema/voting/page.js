'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../../_components/NavBar';
import { Main } from '../../../../_components/Main';
import { AccountBoundary } from '../../../../_components/AccountBoundary';
import { MfaPanel } from '../../../../_components/MfaPanel';
import { Button } from '../../../../_components/Button';
import { gatewayFetch } from '../../../../_lib/gateway';

export default function Page() {
  return (
    <>
      <AppNav />
      <Main>
        <AccountBoundary>
          <VotingQueue />
        </AccountBoundary>
      </Main>
    </>
  );
}
function message(code) {
  return (
    {
      recent_mfa_required: 'Enter a fresh authenticator code, then retry.',
      not_authorized: 'Cinema administrator permission is required.',
      access_required:
        'Open this page through the protected administrator site.',
      voting_not_open: 'Voting is not open yet.',
      self_review_forbidden: 'You cannot review your own vote or title.',
      account_not_active: 'This voter or title is no longer eligible.',
      competition_capacity:
        'Close an existing competition before creating another.',
      idempotency_conflict: 'This request changed. Refresh and try again.',
      rate_limited: 'Too many requests. Wait a minute and retry.',
    }[code] || 'The request was not confirmed. Retry to check the same action.'
  );
}
function VotingQueue() {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setBusy(true);
    setError('');
    setData(null);
    try {
      const next = await gatewayFetch('/admin/cinema/voting');
      if (version === generation.current) setData(next);
    } catch (e) {
      if (version === generation.current) setError(message(e.code));
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
    return () => {
      generation.current++;
    };
  }, [load]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 pb-32">
      <Link href="/app/admin/cinema" className="underline">
        Cinema operations
      </Link>
      <h1 className="mt-5 text-3xl font-black">Cinema voting</h1>
      <p className="my-5">
        Create a voting window, close competitions, and review votes held for
        unusual activity. Counts alone do not declare rankings or winners. Each
        action requires an audit reason.
      </p>
      <MfaPanel requireFresh onVerified={load} />
      <Button className="mt-5" onClick={load} disabled={busy}>
        {busy ? 'Loading…' : 'Refresh voting queue'}
      </Button>
      {error && (
        <p role="alert" className="mt-4">
          {error}
        </p>
      )}
      {data && (
        <>
          <h2 className="mt-8 text-xl font-bold">New competition</h2>
          <ActionForm action="create_competition" onDone={load} />
          <h2 className="mt-8 text-xl font-bold">Competitions</h2>
          {data.competitions.length === 0 && <p>No competitions yet.</p>}
          {data.competitions.map((c) => (
            <article
              key={c.id}
              className="mt-4 rounded-xl border border-vx-border p-4"
            >
              <h3 className="font-bold">{c.name}</h3>
              <p>
                {c.status} · {new Date(c.starts_at).toLocaleString()} –{' '}
                {new Date(c.ends_at).toLocaleString()}
              </p>
              <p className="text-sm">{c.target_types.join(', ')}</p>
              {c.status === 'open' && (
                <ActionForm
                  action="close_competition"
                  id={c.id}
                  onDone={load}
                />
              )}
            </article>
          ))}
          {data.competitions.length === 50 && (
            <p className="mt-4">Showing the latest 50 competitions.</p>
          )}
          <h2 className="mt-8 text-xl font-bold">Votes awaiting review</h2>
          {data.votes.length === 0 && (
            <p role="status">No votes awaiting review.</p>
          )}
          {data.votes.map((v) => (
            <article
              key={v.id}
              className="mt-4 rounded-xl border border-vx-border p-4"
            >
              <h3 className="font-bold">{v.title}</h3>
              <p>
                {v.display_name} (@{v.username}) ·{' '}
                {new Date(v.created_at).toLocaleString()}
              </p>
              <p>Held for unusual voting activity.</p>
              <ActionForm action="review_vote" id={v.id} onDone={load} />
            </article>
          ))}
          {data.votes.length === 100 && (
            <p>
              Showing the oldest 100 held votes. Refresh after reviewing to load
              more.
            </p>
          )}
        </>
      )}
    </div>
  );
}
function ActionForm({ action, id, onDone }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const attempt = useRef(null);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = { action, reason: form.get('reason').trim() };
    if (id) payload.id = id;
    if (action === 'review_vote') payload.decision = form.get('decision');
    if (action === 'create_competition') {
      payload.name = form.get('name').trim();
      payload.starts_at = new Date(form.get('starts_at')).toISOString();
      payload.ends_at = new Date(form.get('ends_at')).toISOString();
      payload.target_types = form.getAll('target_types');
      if (!payload.target_types.length) {
        setError('Select at least one content type.');
        return;
      }
    }
    const body = JSON.stringify(payload);
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      await gatewayFetch('/admin/cinema/voting', {
        method: 'POST',
        body,
        headers: { 'idempotency-key': attempt.current.key },
      });
      await onDone();
    } catch (e) {
      setError(message(e.code));
      setBusy(false);
    }
  }
  return (
    <form className="mt-4 space-y-3" onSubmit={submit}>
      {action === 'create_competition' && (
        <>
          <label className="block">
            Competition name
            <input
              name="name"
              required
              maxLength={80}
              className="mt-1 w-full rounded-lg bg-vx-panel p-3"
            />
          </label>
          <label className="block">
            Starts (your local time)
            <input
              name="starts_at"
              type="datetime-local"
              required
              className="ml-2 rounded-lg bg-vx-panel p-2"
            />
          </label>
          <label className="block">
            Ends (your local time)
            <input
              name="ends_at"
              type="datetime-local"
              required
              className="ml-2 rounded-lg bg-vx-panel p-2"
            />
          </label>
          <p className="text-sm">Maximum window: 31 days.</p>
          <fieldset>
            <legend>Eligible content</legend>
            {['FILM', 'SHORT', 'TRAILER', 'SERIES', 'EPISODE'].map((t) => (
              <label key={t} className="mr-3 inline-block">
                <input type="checkbox" name="target_types" value={t} /> {t}
              </label>
            ))}
          </fieldset>
        </>
      )}
      {action === 'review_vote' && (
        <label className="block">
          Decision
          <select
            name="decision"
            required
            className="ml-2 rounded-lg bg-vx-panel p-2"
          >
            <option value="">Choose…</option>
            <option value="qualified">Count vote</option>
            <option value="rejected">Exclude vote</option>
          </select>
        </label>
      )}
      <label className="block">
        Internal audit reason
        <textarea
          name="reason"
          required
          minLength={3}
          maxLength={500}
          rows={2}
          className="mt-1 w-full rounded-lg bg-vx-panel p-3"
        />
      </label>
      <p className="text-xs">Do not include sensitive personal information.</p>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy
          ? 'Saving…'
          : action === 'create_competition'
            ? 'Create competition'
            : action === 'close_competition'
              ? 'Close competition'
              : 'Save vote decision'}
      </Button>
    </form>
  );
}
