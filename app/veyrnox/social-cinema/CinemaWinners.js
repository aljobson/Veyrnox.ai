"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "../_components/Button";
export function CinemaWinners() {
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
        Weekly winners
      </h2>
      <p className="mt-4 max-w-2xl text-vx-fg-body">
        Votes, viewing completion, audience, sharing and approved comments
        contribute to weekly scores. A separate moderator approves publication.
        There are no cash prizes.
      </p>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer">How rankings work</summary>
        <p className="mt-3">
          Votes count for 40%, completion 25%, viewers 15%, sharing 10% and
          engagement 10%. Accounts with enough reported viewing contribute to
          audience signals. Sharing counts copy/share actions, which do not
          prove external delivery. Invalid and held activity is excluded; equal
          scores share a rank.
        </p>
      </details>
      {state === "loading" && (
        <p role="status" className="mt-6">
          Loading weekly winners…
        </p>
      )}
      {state === "closed" && (
        <p role="status" className="mt-6">
          Weekly rankings will open after launch review.
        </p>
      )}
      {state === "error" && (
        <div role="alert" className="mt-6">
          <p>Weekly winners are unavailable right now.</p>
          <Button className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            Retry winners
          </Button>
        </div>
      )}
      {state === "ready" && !weeks.length && (
        <p role="status" className="mt-6">
          No moderator-approved winners yet.
        </p>
      )}
      {state === "ready" &&
        weeks.map((w) => (
          <article
            key={w.id}
            className="mt-8 rounded-2xl border border-vx-border p-5"
          >
            <h3 className="text-xl font-bold">{w.name}</h3>
            <p className="mt-2 text-xs text-vx-fg-muted">
              Week ended{" "}
              {new Date(w.ends_at).toLocaleDateString("en-GB", {
                timeZone: "Europe/London",
              })}
            </p>
            {w.titles.length ? (
              <ol className="mt-4 space-y-3">
                {w.titles.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={
                        t.content_type === "EPISODE"
                          ? `/social-cinema/watch/${t.id}?title_id=${t.root_id}`
                          : `/social-cinema/title/${t.root_id}`
                      }
                      className="block rounded-xl bg-vx-panel p-4 hover:underline"
                    >
                      <span className="text-vx-accent">#{t.rank}</span> ·{" "}
                      {t.title}
                      <span className="ml-3 text-sm text-vx-fg-muted">
                        {t.score.toFixed(2)} points
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-4">These titles are currently unavailable.</p>
            )}
          </article>
        ))}
    </section>
  );
}
