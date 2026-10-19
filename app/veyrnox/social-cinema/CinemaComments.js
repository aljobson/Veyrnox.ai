'use client';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { tOr } from '../../../lib/i18n/translate.mjs';
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
const labels = (t) => ({
  pending: t("cinema.comments.awaitingModeratorApproval"),
  rejected: t("cinema.comments.notApproved"),
  removed: t("cinema.comments.removedByModeration"),
  withdrawn: t("cinema.comments.withdrawn"),
});
const message = (code, t) =>
  ({
    profile_required: t("cinema.comments.createAnActiveCinemaProfileTo"),
    pending_limit:
      t("cinema.comments.youAlreadyHaveFiveCommentsAwaiting"),
    rate_limited:
      t("cinema.comments.pleaseWaitBeforePostingAgainComments"),
    comment_not_found: t("cinema.comments.thisCommentIsNoLongerAvailable"),
    account_not_active: t("cinema.comments.yourCinemaAccountIsUnavailableContact"),
  })[code] || t("cinema.comments.yourRequestWasNotConfirmedRetry");
export function CinemaComments({ contentId }) {
  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  return (
    <Comments
      key={`${contentId}:${account}`}
      contentId={contentId}
      account={account}
    />
  );
}
function Comments({ contentId, account }) {
  const { t, href: localize, locale } = useI18n();

  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [closed, setClosed] = useState(false),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState(''),
    [reporting, setReporting] = useState('');
  const generation = useRef(0),
    attempts = useRef(new Map());
  const load = useCallback(
    async (before = null) => {
      const seq = ++generation.current;
      try {
        const path = `/cinema/comments?content_id=${encodeURIComponent(contentId)}${before ? `&before_id=${encodeURIComponent(before)}` : ''}`;
        const next = account
          ? await gatewayFetch(path)
          : await fetch(`/api${path}`, { cache: 'no-store' }).then(
              async (r) => {
                const body = await r.json();
                if (!r.ok)
                  throw Object.assign(Error('failed'), { code: body.error });
                return body;
              },
            );
        if (seq === generation.current) {
          setData((previous) =>
            before && previous
              ? {
                  ...next,
                  comments: [
                    ...previous.comments,
                    ...next.comments.filter(
                      (c) => !previous.comments.some((p) => p.id === c.id),
                    ),
                  ],
                }
              : next,
          );
          setClosed(false);
        }
      } catch (e) {
        if (seq === generation.current) {
          setClosed(
            e.code === 'comments_not_open' || e.code === 'content_not_found',
          );
          setError(message(e.code, t));
        }
      }
    },
    [account, contentId, t],
  );
  useEffect(() => {
    load();
    return () => {
      generation.current++;
    };
  }, [load]);
  async function mutate(payload) {
    const body = JSON.stringify(payload);
    if (!attempts.current.has(body))
      attempts.current.set(body, crypto.randomUUID());
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await gatewayFetch('/cinema/comments', {
        method: 'POST',
        body,
        headers: { 'idempotency-key': attempts.current.get(body) },
      });
      if (payload.action === 'submit') {
        setDraft('');
        setNotice(
          t("cinema.comments.submittedForModeratorApprovalYourComment"),
        );
      } else if (payload.action === 'withdraw')
        setNotice(t("cinema.comments.yourCommentWasWithdrawn"));
      else {
        setReporting('');
        setNotice(
          result.status === 'resolved'
            ? t("cinema.comments.thisReportHasAlreadyBeenReviewed")
            : t("cinema.comments.reportReceivedForModeratorReview"),
        );
      }
      await load();
      return true;
    } catch (e) {
      setError(message(e.code, t));
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (closed) return null;
  const withdraw = (id) => (
    <button
      className="mt-2 text-sm underline"
      disabled={busy}
      onClick={() => mutate({ action: 'withdraw', comment_id: id })}
    >
      {t("cinema.comments.withdrawComment")}</button>
  );
  return (
    <section
      className="mt-10 rounded-2xl border border-vx-border p-5"
      aria-labelledby={`comments-${contentId}`}
    >
      <h2 id={`comments-${contentId}`} className="text-xl font-bold">
        {t("cinema.comments.comments")}</h2>
      <p className="mt-2 text-sm text-vx-fg-muted">
        {t("cinema.comments.commentsAreReviewedBeforePublicationBe")}</p>
      {account ? (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutate({
              action: 'submit',
              content_id: contentId,
              body: draft.trim(),
            });
          }}
        >
          <label className="block">
            {t("cinema.comments.yourComment")}<textarea
              name="comment"
              required
              minLength={1}
              maxLength={2000}
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="mt-3 rounded-full border border-vx-border px-4 py-2 font-bold disabled:opacity-50"
          >
            {t("cinema.comments.submitForReview")}</button>
        </form>
      ) : (
        <button
          className="mt-4 underline"
          onClick={() =>
            window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))
          }
        >
          {t("cinema.comments.signInToComment")}</button>
      )}
      {error && (
        <p role="alert" className="mt-4">
          {error}{' '}
          <Link href={localize("/social-cinema")} className="underline">
            {t("cinema.comments.cinemaProfile")}</Link>{' '}
          <button onClick={() => load()} disabled={busy} className="underline">
            {t("cinema.comments.retryComments")}</button>
        </p>
      )}
      {notice && (
        <p role="status" aria-live="polite" className="mt-4">
          {notice}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="mt-4">
          {t("cinema.comments.loadingComments")}</p>
      )}
      {data?.own_comments?.length > 0 && (
        <div className="mt-6">
          <h3 className="font-bold">
            {t("cinema.comments.yourCommentsAwaitingPublicationOrRemoved")}</h3>
          {data.own_comments.map((c) => (
            <article key={c.id} className="mt-3 rounded-lg bg-vx-panel p-3">
              <p className="text-xs">{labels(t)[c.status]}</p>
              <p className="mt-2 whitespace-pre-wrap wrap-break-word">
                {c.body}
              </p>
              {c.status !== 'withdrawn' && withdraw(c.id)}
            </article>
          ))}
        </div>
      )}
      {data?.comments?.length === 0 && (
        <p className="mt-6 text-sm">{t("cinema.comments.noApprovedCommentsYet")}</p>
      )}
      {data?.comments?.map((c) => (
        <article key={c.id} className="mt-5 border-t border-vx-border pt-4">
          <p className="text-sm font-bold">
            {c.display_name}{' '}
            <span className="font-normal text-vx-fg-muted">
              @{c.username} · {new Date(c.created_at).toLocaleString(localeTag(locale))}
            </span>
          </p>
          <p className="mt-2 whitespace-pre-wrap wrap-break-word">{c.body}</p>
          {c.own
            ? withdraw(c.id)
            : account && (
                <button
                  className="mt-2 text-sm underline"
                  disabled={busy}
                  onClick={() => setReporting(c.id)}
                >
                  {t("cinema.comments.reportComment")}</button>
              )}
          {reporting === c.id && (
            <form
              className="mt-3 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                mutate({
                  action: 'report',
                  comment_id: c.id,
                  category: f.get('category'),
                  details: f.get('details').trim(),
                });
              }}
            >
              <label className="block">
                {t("cinema.comments.reportCategory")}<select
                  name="category"
                  className="ms-2 rounded-lg bg-vx-panel p-2"
                >
                  {['spam', 'abuse', 'privacy', 'rights', 'other'].map((category) => (
                    <option key={category} value={category}>
                      {tOr(t, `cinema.report.${category}`, category)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                {t("cinema.comments.reasonForReport")}<textarea
                  name="details"
                  required
                  minLength={3}
                  maxLength={500}
                  className="mt-1 w-full rounded-lg bg-vx-panel p-3"
                />
              </label>
              <p className="text-xs">
                {t("cinema.comments.doNotIncludeSensitivePersonalInformation")}</p>
              <button type="submit" disabled={busy} className="underline">
                {t("cinema.comments.sendReport")}</button>{' '}
              <button
                type="button"
                onClick={() => setReporting('')}
                className="underline"
              >
                {t("cinema.comments.cancelReport")}</button>
            </form>
          )}
        </article>
      ))}
      {data?.next_cursor && (
        <button
          className="mt-5 underline"
          disabled={busy}
          onClick={() => load(data.next_cursor)}
        >
          {t("cinema.comments.olderComments")}</button>
      )}
    </section>
  );
}
