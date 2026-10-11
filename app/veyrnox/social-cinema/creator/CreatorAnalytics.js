"use client";
import { useEffect, useRef, useState } from "react";
import { gatewayFetch } from "../../_lib/gateway";
import { Button } from "../../_components/Button";
const labels = {
  viewers: "Qualified viewers",
  completions: "Completed viewing",
  voters: "Viewers who voted",
  sharers: "Viewers who shared",
  commenters: "Viewers who commented",
};
const message = (code) =>
  code === "creator_required"
    ? "Analytics are available to active Cinema creators."
    : code === "content_not_found"
      ? "This title is no longer available for analytics."
      : code === "rate_limited"
        ? "Please wait a minute before trying again."
        : "Analytics are temporarily unavailable. Try again.";
export function CreatorAnalytics() {
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
          (t) =>
            t.lifecycle_status === "PUBLISHED" &&
            t.visibility === "PUBLIC" &&
            !t.parent_id,
        );
        setTitles(available);
        const id = available.some((t) => t.id === selected)
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
          setError(message(e.code));
          setState("error");
        }
      }
    });
    return () => {
      generation.current = current + 1;
    };
  }, [selected, attempt]);
  return (
    <section
      aria-labelledby="creator-analytics-heading"
      className="mt-10 rounded-2xl border border-vx-border bg-vx-panel p-5 sm:p-7"
    >
      <h2 id="creator-analytics-heading" className="text-xl font-bold">
        Your audience
      </h2>
      <p className="mt-2 text-sm text-vx-fg-muted">
        The last 28 complete days, updated daily. Counts cover qualified
        signed-in viewers and exclude your own activity.
      </p>
      {titles.length > 0 && (
        <label className="mt-5 block text-sm font-semibold">
          Published title
          <select
            aria-label="Analytics title"
            value={selected}
            onChange={(e) => {
              setData(null);
              setState("loading");
              setSelected(e.target.value);
            }}
            className="mt-2 w-full rounded-xl border border-vx-border bg-vx-panel px-3 py-2"
          >
            {titles.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {state === "loading" && (
        <p role="status" className="mt-5">
          Loading your audience…
        </p>
      )}
      {state === "empty" && (
        <p role="status" className="mt-5">
          Publish a title to start seeing audience insights.
        </p>
      )}
      {state === "error" && (
        <div role="alert" className="mt-5">
          <p>{error}</p>
          <Button className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            Retry analytics
          </Button>
        </div>
      )}
      {state === "ready" && data.suppressed && (
        <p role="status" className="mt-5" data-testid="analytics-suppressed">
          Audience insights appear after at least five qualified viewers.
          Individual audience details stay private.
        </p>
      )}
      {state === "ready" && !data.suppressed && (
        <>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(labels).map(([key, label]) => (
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
            Completion means at least 90% of watched media; series counts cover
            watched episodes. Shares are copy or share actions, rather than
            confirmed deliveries. Comments count approved, unreported comments.
            These insights do not calculate earnings or weekly ranking scores.
          </p>
        </>
      )}
    </section>
  );
}
