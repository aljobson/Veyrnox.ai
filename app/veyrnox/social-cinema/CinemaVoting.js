'use client';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../components/I18nProvider.jsx';
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
const voteLabels = (t) => ({
  qualified: t("cinema.voting.yourVoteIsCounted"),
  under_review: t("cinema.voting.yourVoteIsAwaitingReview"),
  rejected: t("cinema.voting.yourVoteWasExcludedByModeration"),
});
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
  const { t, href: localize, locale } = useI18n();

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
            ? t("cinema.voting.createAnActiveCinemaProfileTo")
            : t("cinema.voting.votingIsUnavailableRightNowPlease"),
        );
      }
    }
  }, [account, contentId, t]);
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
      setNotice(voteLabels(t)[result.status] || t("cinema.voting.voteRecorded"));
      await load();
    } catch (e) {
      setError(
        {
          competition_closed:
            t("cinema.voting.votingHasClosedRefreshToSee"),
          profile_required: t("cinema.voting.createAnActiveCinemaProfileTo"),
          account_not_active:
            t("cinema.comments.yourCinemaAccountIsUnavailableContact"),
          rate_limited: t("cinema.retention.tooManyRequestsWaitAMinute"),
        }[e.code] ||
          t("cinema.voting.yourVoteWasNotConfirmedRetry"),
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
        {t("cinema.voting.communityVoting")}</h2>
      <p className="mt-2 text-sm text-vx-fg-muted">
        {t("cinema.voting.oneVotePerTitleInEach")}</p>
      {!account && (
        <p className="mt-3 text-sm">
          <button
            className="underline"
            onClick={() =>
              window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))
            }
          >
            {t("cinema.voting.signInToVote")}</button>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm">
          {error}{' '}
          <Link className="underline" href={localize("/social-cinema")}>
            {t("cinema.comments.cinemaProfile")}</Link>{' '}
          <button className="underline" onClick={load}>
            {t("cinema.voting.retryVoting")}</button>
        </p>
      )}
      {notice && (
        <p role="status" aria-live="polite" className="mt-3 text-sm">
          {notice}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="mt-3 text-sm">
          {t("cinema.voting.loadingCompetitions")}</p>
      )}
      {data?.competitions?.length === 0 && (
        <p className="mt-3 text-sm text-vx-fg-muted">
          {t("cinema.voting.noOpenCompetitionForThisTitle")}</p>
      )}
      {data?.competitions?.map((comp) => (
        <article key={comp.id} className="mt-4 rounded-xl bg-vx-panel p-4">
          <h3 className="font-bold">{comp.name}</h3>
          <p className="mt-1 text-sm">
            <span data-testid={`vote-count-${comp.id}`}>
              {comp.qualified_votes}
            </span>{' '}
            {t("cinema.discovery.qualifiedVotesCloses")}{' '}{new Date(comp.ends_at).toLocaleString(localeTag(locale))}
          </p>
          {comp.my_vote ? (
            <p className="mt-3 text-sm">{voteLabels(t)[comp.my_vote.status]}</p>
          ) : (
            account && (
              <button
                className="mt-3 rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50"
                disabled={!!busy}
                onClick={() => vote(comp)}
              >
                {busy === comp.id ? t("cinema.storyPolls.recording") : t('cinema.voting.voteIn', { name: comp.name })}
              </button>
            )
          )}
        </article>
      ))}
    </section>
  );
}
