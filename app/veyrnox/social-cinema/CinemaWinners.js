"use client";
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "../_components/Button";
export function CinemaWinners() {
  const { t, href: localize, locale } = useI18n();

  const [state, setState] = useState("loading"),
    [weeks, setWeeks] = useState([]),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState("loading");
    setWeeks([]);
    fetch("/api/cinema/winners", { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Object.assign(Error(), { code: b.error });
        if (!active) return;
        setWeeks(b.weeks);
        setState("ready");
      })
      .catch((e) => {
        if (active)
          setState(e.code === "rankings_not_open" ? "closed" : "error");
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <section
      aria-live="polite"
      className="py-10"
      aria-labelledby="weekly-winners"
    >
      <h2 id="weekly-winners" className="text-2xl font-extrabold">
        {t("cinema.winners.weeklyWinners")}</h2>
      <p className="mt-4 max-w-2xl text-vx-fg-body">
        {t("cinema.winners.votesViewingCompletionAudienceSharingAnd")}</p>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer">{t("cinema.winners.howRankingsWork")}</summary>
        <p className="mt-3">
          {t("cinema.winners.votesCountFor40Completion25")}</p>
      </details>
      {state === "loading" && (
        <p role="status" className="mt-6">
          {t("cinema.winners.loadingWeeklyWinners")}</p>
      )}
      {state === "closed" && (
        <p role="status" className="mt-6">
          {t("cinema.winners.weeklyRankingsWillOpenAfterLaunch")}</p>
      )}
      {state === "error" && (
        <div role="alert" className="mt-6">
          <p>{t("cinema.winners.weeklyWinnersAreUnavailableRightNow")}</p>
          <Button className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            {t("cinema.winners.retryWinners")}</Button>
        </div>
      )}
      {state === "ready" && !weeks.length && (
        <p role="status" className="mt-6">
          {t("cinema.winners.noModeratorApprovedWinnersYet")}</p>
      )}
      {state === "ready" &&
        weeks.map((w) => (
          <article
            key={w.id}
            className="mt-8 rounded-2xl border border-vx-border p-5"
          >
            <h3 className="text-xl font-bold">{w.name}</h3>
            <p className="mt-2 text-xs text-vx-fg-muted">
              {t("cinema.winners.weekEnded")}{" "}
              {new Date(w.ends_at).toLocaleDateString(localeTag(locale, 'en-GB'), {
                timeZone: "Europe/London",
              })}
            </p>
            {w.titles.length ? (
              <ol className="mt-4 space-y-3">
                {w.titles.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={localize(item.content_type === "EPISODE"
                          ? `/social-cinema/watch/${item.id}?title_id=${item.root_id}`
                          : `/social-cinema/title/${item.root_id}`)}
                      className="block rounded-xl bg-vx-panel p-4 hover:underline"
                    >
                      <span className="text-vx-accent">#{item.rank}</span> ·{" "}
                      {item.title}
                      <span className="ms-3 text-sm text-vx-fg-muted">
                        {t('cinema.winners.points', { count: item.score.toFixed(2) })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-4">{t("cinema.winners.theseTitlesAreCurrentlyUnavailable")}</p>
            )}
          </article>
        ))}
    </section>
  );
}
