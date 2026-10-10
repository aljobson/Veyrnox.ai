'use client';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { getSession, onSessionChange } from '../../lib/authClient.js';
import { gatewayFetch } from '../_lib/gateway.js';
const identity = () => getSession()?.user?.id || '',
  noIdentity = () => '';
const voteLabels = {
  qualified: 'Your vote is counted.',
  under_review: 'Your vote is awaiting review.',
  rejected: 'Your vote was excluded by moderation.',
};
export function CinemaVoting({ contentId }) {
  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  return (
    <Voting
      key={`${contentId}:${account}`}
      contentId={contentId}
      account={account}
    />
  );
}
function Voting({ contentId, account }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [closed, setClosed] = useState(false),
    [busy, setBusy] = useState(''),
    [notice, setNotice] = useState('');
  const generation = useRef(0),
    attempt = useRef(null);
  const load = useCallback(async () => {
    const seq = ++generation.current;
    setError('');
    try {
      const path = `/cinema/voting?content_id=${encodeURIComponent(contentId)}`;
      const next = account
        ? await gatewayFetch(path)
        : await fetch(`/api${path}`, { cache: 'no-store' }).then(async (r) => {
            const body = await r.json();
            if (!r.ok)
              throw Object.assign(Error('failed'), { code: body.error });
            return body;
          });
      if (seq === generation.current) {
        setData(next);
        setClosed(false);
      }
    } catch (e) {
      if (seq === generation.current) {
        setClosed(
          e.code === 'voting_not_open' || e.code === 'content_not_found',
        );
        setData(null);
        setError(
          e.code === 'profile_required'
            ? 'Create an active Cinema profile to vote.'
            : 'Voting is unavailable right now. Please retry.',
        );
      }
    }
  }, [account, contentId]);
  useEffect(() => {
    load();
    return () => {
      generation.current++;
    };
  }, [load]);
  async function vote(comp) {
    const body = JSON.stringify({
      content_id: contentId,
      competition_id: comp.id,
    });
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setBusy(comp.id);
    setNotice('');
    setError('');
    try {
      const result = await gatewayFetch('/cinema/votes', {
        method: 'POST',
        body,
        headers: { 'idempotency-key': attempt.current.key },
      });
      setNotice(voteLabels[result.status] || 'Vote recorded.');
      await load();
    } catch (e) {
      setError(
        {
          competition_closed:
            'Voting has closed. Refresh to see current competitions.',
          profile_required: 'Create an active Cinema profile to vote.',
          account_not_active:
            'Your Cinema account is unavailable. Contact support.',
          rate_limited: 'Too many requests. Wait a minute and retry.',
        }[e.code] ||
          'Your vote was not confirmed. Retry to check the same ballot.',
      );
    } finally {
      setBusy('');
    }
  }
  if (closed) return null;
  return (
    <section
      className="mt-10 rounded-2xl border border-vx-border p-5"
      aria-labelledby={`vote-${contentId}`}
    >
      <h2 id={`vote-${contentId}`} className="text-xl font-bold">
        Community voting
      </h2>
      <p className="mt-2 text-sm text-vx-fg-muted">
        One vote per title in each open competition. Voting is free. Votes held
        for review are excluded from the count until approved.
      </p>
      {!account && (
        <p className="mt-3 text-sm">
          <button
            className="underline"
            onClick={() =>
              window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))
            }
          >
            Sign in to vote
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm">
          {error}{' '}
          <Link className="underline" href="/social-cinema">
            Cinema profile
          </Link>{' '}
          <button className="underline" onClick={load}>
            Retry voting
          </button>
        </p>
      )}
      {notice && (
        <p role="status" aria-live="polite" className="mt-3 text-sm">
          {notice}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="mt-3 text-sm">
          Loading competitions…
        </p>
      )}
      {data?.competitions?.length === 0 && (
        <p className="mt-3 text-sm text-vx-fg-muted">
          No open competition for this title.
        </p>
      )}
      {data?.competitions?.map((comp) => (
        <article key={comp.id} className="mt-4 rounded-xl bg-vx-panel p-4">
          <h3 className="font-bold">{comp.name}</h3>
          <p className="mt-1 text-sm">
            <span data-testid={`vote-count-${comp.id}`}>
              {comp.qualified_votes}
            </span>{' '}
            qualified votes · Closes {new Date(comp.ends_at).toLocaleString()}
          </p>
          {comp.my_vote ? (
            <p className="mt-3 text-sm">{voteLabels[comp.my_vote.status]}</p>
          ) : (
            account && (
              <button
                className="mt-3 rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50"
                disabled={!!busy}
                onClick={() => vote(comp)}
              >
                {busy === comp.id ? 'Recording…' : `Vote in ${comp.name}`}
              </button>
            )
          )}
        </article>
      ))}
    </section>
  );
}
