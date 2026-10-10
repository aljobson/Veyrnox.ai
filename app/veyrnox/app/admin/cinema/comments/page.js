'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '../../../../_components/NavBar';
import { Main } from '../../../../_components/Main';
import { AccountBoundary } from '../../../../_components/AccountBoundary';
import { MfaPanel } from '../../../../_components/MfaPanel';
import { Button } from '../../../../_components/Button';
import { gatewayFetch } from '../../../../_lib/gateway';
const message = (code) =>
  ({
    recent_mfa_required: 'Enter a fresh authenticator code, then retry.',
    not_authorized: 'Cinema administrator permission is required.',
    access_required: 'Open this through the protected administrator site.',
    comments_not_open: 'Comments are not open yet.',
    self_review_forbidden:
      'You cannot review your own comment, title, or report.',
    already_reviewed:
      'Another reviewer has decided this item. Refresh the queue.',
    account_not_active: 'This author or title is no longer eligible.',
  })[code] || 'The action was not confirmed. Retry to check the same decision.';
export default function Page() {
  return (
    <>
      <AppNav />
      <Main>
        <AccountBoundary>
          <Queue />
        </AccountBoundary>
      </Main>
    </>
  );
}
function Queue() {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const seq = ++generation.current;
    setBusy(true);
    setError('');
    setData(null);
    try {
      const r = await gatewayFetch('/admin/cinema/comments');
      if (seq === generation.current) setData(r);
    } catch (e) {
      if (seq === generation.current) setError(message(e.code));
    } finally {
      if (seq === generation.current) setBusy(false);
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
      <h1 className="mt-5 text-3xl font-black">Cinema comment moderation</h1>
      <p className="my-5">
        Comments stay private until approved. Review the content and context
        before deciding. Removing a reported comment and resolving its report
        are separate audited actions.
      </p>
      <MfaPanel requireFresh onVerified={load} />
      <Button className="mt-5" disabled={busy} onClick={load}>
        Refresh comments and reports
      </Button>
      {error && (
        <p role="alert" className="mt-4">
          {error}
        </p>
      )}
      {data && (
        <>
          <h2 className="mt-8 text-xl font-bold">Awaiting approval</h2>
          {data.comments.length === 0 && (
            <p role="status">No comments awaiting approval.</p>
          )}
          {data.comments.map((c) => (
            <article
              key={c.id}
              className="mt-5 rounded-xl border border-vx-border p-4"
            >
              <Link
                href={`/social-cinema/watch/${c.content_id}`}
                className="font-bold underline"
              >
                {c.title}
              </Link>
              <p className="mt-2 text-sm">
                {c.display_name} (@{c.username}) ·{' '}
                {new Date(c.created_at).toLocaleString()}
              </p>
              <p className="mt-3 whitespace-pre-wrap wrap-break-word">
                {c.body}
              </p>
              <Decision action="review_comment" id={c.id} onDone={load} />
            </article>
          ))}
          {data.comments.length === 50 && (
            <p>Showing the oldest 50. Refresh after reviewing to load more.</p>
          )}
          <h2 className="mt-8 text-xl font-bold">Reported comments</h2>
          {data.reports.length === 0 && <p role="status">No open reports.</p>}
          {data.reports.map((r) => (
            <article
              key={r.id}
              className="mt-5 rounded-xl border border-vx-border p-4"
            >
              <p className="font-bold">
                {r.title} · {r.category}
              </p>
              <p className="mt-3 whitespace-pre-wrap wrap-break-word">
                {r.body}
              </p>
              <p className="mt-3 whitespace-pre-wrap wrap-break-word">
                Report: {r.details}
              </p>
              <p className="mt-2">Comment status: {r.comment_status}</p>
              {r.comment_status === 'approved' && (
                <Decision
                  action="review_comment"
                  id={r.comment_id}
                  remove
                  onDone={load}
                />
              )}
              <Decision action="resolve_report" id={r.id} onDone={load} />
            </article>
          ))}
          {data.reports.length === 50 && <p>Showing the oldest 50 reports.</p>}
        </>
      )}
    </div>
  );
}
function Decision({ action, id, remove = false, onDone }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const attempt = useRef(null);
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      payload = { action, id, reason: f.get('reason').trim() };
    if (action === 'review_comment')
      payload.decision = remove ? 'removed' : f.get('decision');
    const body = JSON.stringify(payload);
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      await gatewayFetch('/admin/cinema/comments', {
        method: 'POST',
        body,
        headers: { 'idempotency-key': attempt.current.key },
      });
      await onDone();
    } catch (err) {
      setError(message(err.code));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      {action === 'review_comment' && !remove && (
        <label className="block">
          Decision
          <select
            name="decision"
            required
            className="ml-2 rounded-lg bg-vx-panel p-2"
          >
            <option value="">Choose…</option>
            <option value="approved">Approve and publish</option>
            <option value="rejected">Reject</option>
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
          : remove
            ? 'Remove comment'
            : action === 'resolve_report'
              ? 'Resolve report'
              : 'Save comment decision'}
      </Button>
    </form>
  );
}
