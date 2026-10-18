"use client";
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../lib/i18n/translate.mjs';
import { rich } from '../../../lib/i18n/rich';
import { useI18n } from '../../../components/I18nProvider.jsx';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getSession, onSessionChange } from "../../lib/authClient.js";
import { gatewayFetch } from "../_lib/gateway.js";
const identity = () => getSession()?.user?.id || "",
  noIdentity = () => "";
const labels = (t) => ({
  qualified: t("cinema.storyPolls.yourChoiceIsCounted"),
  under_review: t("cinema.storyPolls.yourChoiceIsAwaitingReview"),
  rejected: t("cinema.storyPolls.yourChoiceWasExcludedByModeration"),
});
export function CinemaStoryPolls({ contentId }) {
  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  return (
    <Polls
      key={`${contentId}:${account}`}
      contentId={contentId}
      account={account}
    />
  );
}
function Polls({ contentId, account }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [closed, setClosed] = useState(false),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState({});
  const generation = useRef(0),
    attempt = useRef(null);
  const load = useCallback(async () => {
    const seq = ++generation.current;
    setError("");
    try {
      const path = `/cinema/story-polls?content_id=${encodeURIComponent(contentId)}`;
      const next = account
        ? await gatewayFetch(path)
        : await fetch(`/api${path}`, { cache: "no-store" }).then(async (r) => {
            const body = await r.json();
            if (!r.ok)
              throw Object.assign(Error("failed"), { code: body.error });
            return body;
          });
      if (seq === generation.current) {
        setData(next);
        setClosed(false);
      }
    } catch (e) {
      if (seq === generation.current) {
        setData(null);
        setClosed(
          e.code === "story_polls_not_open" || e.code === "content_not_found",
        );
        setError(
          e.code === "profile_required"
            ? t("cinema.storyPolls.createAnActiveCinemaProfileTo")
            : t("cinema.storyPolls.storyPollsAreUnavailableRightNow"),
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
  async function choose(event, poll) {
    event.preventDefault();
    if (!selected[poll.id] || busy) return;
    const body = JSON.stringify({
      poll_id: poll.id,
      option_id: selected[poll.id],
    });
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setBusy(poll.id);
    setNotice("");
    setError("");
    try {
      const result = await gatewayFetch("/cinema/story-choices", {
        method: "POST",
        body,
        headers: { "idempotency-key": attempt.current.key },
      });
      setNotice(labels(t)[result.status] || t("cinema.storyPolls.choiceRecorded"));
      await load();
    } catch (e) {
      if (e.code === "choice_already_recorded" || e.code === "poll_closed")
        await load();
      setError(
        {
          choice_already_recorded:
            t("cinema.storyPolls.youHaveAlreadyAnsweredThisPoll"),
          poll_closed:
            t("cinema.storyPolls.thisPollHasClosedNewAnswers"),
          profile_required:
            t("cinema.storyPolls.createAnActiveCinemaProfileTo"),
          account_not_active:
            t("cinema.comments.yourCinemaAccountIsUnavailableContact"),
          rate_limited: t("cinema.retention.tooManyRequestsWaitAMinute"),
        }[e.code] ||
          t("cinema.storyPolls.yourChoiceWasNotConfirmedRetry"),
      );
    } finally {
      setBusy("");
    }
  }
  if (closed) return null;
  return (
    <section
      className="mt-10 rounded-2xl border border-vx-border p-5"
      aria-labelledby={`polls-${contentId}`}
    >
      <h2 id={`polls-${contentId}`} className="text-xl font-bold">
        {t("cinema.storyPolls.storyChoices")}</h2>
      <p className="mt-2 text-sm text-vx-fg-muted">
        {t("cinema.storyPolls.chooseWhereTheStoryGoesNext")}</p>
      {!account && (
        <button
          className="mt-3 underline"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("veyrnox:auth-required"))
          }
        >
          {t("cinema.storyPolls.signInToChoose")}</button>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm">
          {error}{" "}
          <button className="underline" onClick={load}>
            {t("cinema.storyPolls.refreshStoryPolls")}</button>
        </p>
      )}
      {notice && (
        <p role="status" aria-live="polite" className="mt-3 text-sm">
          {notice}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="mt-3 text-sm">
          {t("cinema.storyPolls.loadingStoryPolls")}</p>
      )}
      {data?.polls?.length === 0 && (
        <p className="mt-3 text-sm text-vx-fg-muted">
          {t("cinema.storyPolls.noStoryPollsForThisEpisode")}</p>
      )}
      {data?.polls?.map((poll) => (
        <article key={poll.id} className="mt-4 rounded-xl bg-vx-panel p-4">
          <h3 className="font-bold">{poll.question}</h3>
          <p className="mt-1 text-sm">
            {poll.is_open ? t("cinema.storyPolls.closes") : t("cinema.storyPolls.closed")}{" "}
            {new Date(poll.closes_at).toLocaleString(localeTag(locale))}
          </p>
          <form onSubmit={(event) => choose(event, poll)} className="mt-3">
            <fieldset
              disabled={!!busy || !account || !!poll.my_choice || !poll.is_open}
            >
              <legend className="text-sm">{t("cinema.storyPolls.chooseOneAnswer")}</legend>
              {poll.options.map((option) => (
                <label
                  key={option.id}
                  className="mt-2 flex items-center gap-3 rounded-lg border border-vx-border p-3"
                >
                  <input
                    type="radio"
                    name={`choice-${poll.id}`}
                    value={option.id}
                    checked={
                      (poll.my_choice?.option_id || selected[poll.id]) ===
                      option.id
                    }
                    onChange={() =>
                      setSelected((current) => ({
                        ...current,
                        [poll.id]: option.id,
                      }))
                    }
                  />
                  <span>
                    {option.label} —{" "}
                    {rich(t(pluralKey(t, locale, 'cinema.polls.answers', option.votes)), {
                      count: <span data-testid={`story-choice-count-${option.id}`}>{option.votes}</span>,
                    })}
                  </span>
                </label>
              ))}
            </fieldset>
            {poll.my_choice ? (
              <p className="mt-3 text-sm">{labels(t)[poll.my_choice.status]}</p>
            ) : (
              account &&
              poll.is_open && (
                <button
                  type="submit"
                  disabled={!!busy || !selected[poll.id]}
                  className="mt-3 rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50"
                >
                  {busy === poll.id ? t("cinema.storyPolls.recording") : t("cinema.storyPolls.submitStoryChoice")}
                </button>
              )
            )}
          </form>
          <p className="mt-3 text-xs text-vx-fg-muted">
            {t("cinema.storyPolls.answersHeldForReviewAreExcluded")}</p>
        </article>
      ))}
    </section>
  );
}
