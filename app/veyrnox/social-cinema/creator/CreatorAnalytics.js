"use client";
import { useI18n } from '../../../../components/I18nProvider.jsx';
import { useEffect, useRef, useState } from "react";
import { gatewayFetch } from "../../_lib/gateway";
import { Button } from "../../_components/Button";
const labels = (t) => ({
  viewers: t("cinema.creatorAnalytics.qualifiedViewers"),
  completions: t("cinema.creatorAnalytics.completedViewing"),
  voters: t("cinema.creatorAnalytics.viewersWhoVoted"),
  sharers: t("cinema.creatorAnalytics.viewersWhoShared"),
  commenters: t("cinema.creatorAnalytics.viewersWhoCommented"),
});
const message = (code, t) =>
  code === "creator_required"
    ? t("cinema.creatorAnalytics.analyticsAreAvailableToActiveCinema")
    : code === "content_not_found"
      ? t("cinema.creatorAnalytics.thisTitleIsNoLongerAvailable")
      : code === "rate_limited"
        ? t("cinema.creatorAnalytics.pleaseWaitAMinuteBeforeTrying")
        : t("cinema.creatorAnalytics.analyticsAreTemporarilyUnavailableTryAgain");
export function CreatorAnalytics() {
  const { t } = useI18n();
  const [titles, setTitles] = useState([]),
    [selected, setSelected] = useState(""),
    [data, setData] = useState(null);
  const [state, setState] = useState("loading"),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    Promise.resolve().then(async () => {
      if (current !== generation.current) return;
      setState("loading");
      setError("");
      setData(null);
      try {
        const own = await gatewayFetch("/cinema/content");
        if (current !== generation.current) return;
        const available = own.content.filter(
          (item) =>
            item.lifecycle_status === "PUBLISHED" &&
            item.visibility === "PUBLIC" &&
            !item.parent_id,
        );
        setTitles(available);
        const id = available.some((item) => item.id === selected)
          ? selected
          : available[0]?.id;
        if (!id) {
          setSelected("");
          setState("empty");
          return;
        }
        if (selected !== id) {
          setSelected(id);
          return;
        }
        const result = await gatewayFetch(
          `/cinema/creator-analytics?content_id=${encodeURIComponent(id)}`,
        );
        if (current === generation.current) {
          setData(result);
          setState("ready");
        }
      } catch (e) {
        if (current === generation.current) {
          setError(message(e.code, t));
          setState("error");
        }
      }
    });
    return () => {
      generation.current = current + 1;
    };
  }, [selected, attempt, t]);
  return (
    <section
      aria-labelledby="creator-analytics-heading"
      className="mt-10 rounded-2xl border border-vx-border bg-vx-panel p-5 sm:p-7"
    >
      <h2 id="creator-analytics-heading" className="text-xl font-bold">
        {t("cinema.creatorAnalytics.yourAudience")}</h2>
      <p className="mt-2 text-sm text-vx-fg-muted">
        {t("cinema.creatorAnalytics.theLast28CompleteDaysUpdated")}</p>
      {titles.length > 0 && (
        <label className="mt-5 block text-sm font-semibold">
          {t("cinema.creatorAnalytics.publishedTitle")}<select
            aria-label={t("cinema.creatorAnalytics.analyticsTitle")}
            value={selected}
            onChange={(e) => {
              setData(null);
              setState("loading");
              setSelected(e.target.value);
            }}
            className="mt-2 w-full rounded-xl border border-vx-border bg-vx-panel px-3 py-2"
          >
            {titles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {state === "loading" && (
        <p role="status" className="mt-5">
          {t("cinema.creatorAnalytics.loadingYourAudience")}</p>
      )}
      {state === "empty" && (
        <p role="status" className="mt-5">
          {t("cinema.creatorAnalytics.publishATitleToStartSeeing")}</p>
      )}
      {state === "error" && (
        <div role="alert" className="mt-5">
          <p>{error}</p>
          <Button className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            {t("cinema.creatorAnalytics.retryAnalytics")}</Button>
        </div>
      )}
      {state === "ready" && data.suppressed && (
        <p role="status" className="mt-5" data-testid="analytics-suppressed">
          {t("cinema.creatorAnalytics.audienceInsightsAppearAfterAtLeast")}</p>
      )}
      {state === "ready" && !data.suppressed && (
        <>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(labels(t)).map(([key, label]) => (
              <div key={key} className="rounded-xl border border-vx-border p-4">
                <dt className="text-sm text-vx-fg-muted">{label}</dt>
                <dd
                  data-testid={`analytics-${key}`}
                  className="mt-2 text-2xl font-bold"
                >
                  {data.metrics[key].toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-vx-fg-muted">
            {t("cinema.creatorAnalytics.completionMeansAtLeast90Of")}</p>
        </>
      )}
    </section>
  );
}
