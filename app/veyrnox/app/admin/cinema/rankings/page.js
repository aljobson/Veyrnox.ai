"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppNav } from "../../../../_components/NavBar";
import { Main } from "../../../../_components/Main";
import { AccountBoundary } from "../../../../_components/AccountBoundary";
import { MfaPanel } from "../../../../_components/MfaPanel";
import { Button } from "../../../../_components/Button";
import { gatewayFetch } from "../../../../_lib/gateway";
export default function Page() {
  return (
    <>
      <AppNav />
      <Main>
        <AccountBoundary>
          <Rankings />
        </AccountBoundary>
      </Main>
    </>
  );
}
function Rankings() {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setBusy(true);
    setError("");
    setData(null);
    try {
      const r = await gatewayFetch("/admin/cinema/rankings");
      if (version === generation.current) setData(r);
    } catch (e) {
      if (version === generation.current) setError(message(e.code));
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 pb-32">
      <Link href="/app/admin/cinema" className="underline">
        Cinema operations
      </Link>
      <h1 className="mt-6 text-3xl font-black">Weekly rankings</h1>
      <p className="mt-5">
        Freeze a closed week after held votes are reviewed. A different Cinema
        administrator must approve the provisional score before it becomes
        public. Changes to eligible activity require rejecting and rebuilding a
        stale snapshot.
      </p>
      <MfaPanel requireFresh onVerified={load} />
      <Button className="mt-5" onClick={load} disabled={busy}>
        Refresh rankings
      </Button>
      {error && (
        <p role="alert" className="mt-5">
          {error}
        </p>
      )}
      {data && !data.competitions.length && !data.snapshots.length && (
        <p role="status" className="mt-5">
          No closed weeks or provisional rankings.
        </p>
      )}
      {data?.competitions.map((c) => (
        <Decision key={c.id} item={c} actions={["prepare"]} onDone={load} />
      ))}
      {data?.snapshots.map((s) => (
        <article
          key={s.id}
          className="mt-6 rounded-2xl border border-vx-border p-5"
        >
          <h2 className="text-xl font-bold">
            {s.name} · {s.status}
          </h2>
          <p className="mt-2 text-xs">{s.model_version}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    "Rank",
                    "Title",
                    "Points",
                    "Votes",
                    "Viewers",
                    "Completions",
                    "Share actions",
                    "Commenters",
                  ].map((h) => (
                    <th className="p-2" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.content_id}>
                    {[
                      r.rank,
                      r.title,
                      r.score.toFixed(2),
                      r.signals.votes,
                      r.signals.viewers,
                      r.signals.completions,
                      r.signals.shares,
                      r.signals.engagement,
                    ].map((v, i) => (
                      <td className="p-2" key={i}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.status === "provisional" &&
            (s.own ? (
              <p className="mt-4">
                Another administrator must review this snapshot.
              </p>
            ) : (
              <Decision
                item={s}
                actions={["publish", "reject"]}
                onDone={load}
              />
            ))}
        </article>
      ))}
    </div>
  );
}
function Decision({ item, actions, onDone }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    attempt = useRef(null);
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      body = JSON.stringify({
        action: f.get("action"),
        id: item.id,
        reason: String(f.get("reason")).trim(),
      });
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await gatewayFetch("/admin/cinema/rankings", {
        method: "POST",
        body,
        headers: { "idempotency-key": attempt.current.key },
      });
      onDone();
    } catch (err) {
      setError(message(err.code));
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="mt-6 space-y-3"
      aria-label={`Review ${item.name}`}
    >
      <h2 className="font-bold">
        {actions[0] === "prepare" ? item.name : "Publication decision"}
      </h2>
      <label className="block">
        Action
        <select name="action" className="ml-3 rounded-lg bg-vx-panel p-2">
          {actions.map((a) => (
            <option key={a} value={a}>
              {a === "prepare"
                ? "Prepare provisional ranking"
                : a === "publish"
                  ? "Approve and publish"
                  : "Reject snapshot"}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Internal reason
        <textarea
          name="reason"
          required
          minLength={3}
          maxLength={500}
          className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <Button disabled={busy} type="submit">
        {busy ? "Saving…" : "Save ranking decision"}
      </Button>
    </form>
  );
}
function message(code) {
  return (
    {
      not_authenticated: "Sign in with your Cinema administrator account.",
      no_token: "Sign in with your Cinema administrator account.",
      recent_mfa_required: "Enter a fresh authenticator code above.",
      not_authorized: "A current Cinema administrator account is required.",
      self_review_forbidden:
        "A separate administrator must approve this snapshot.",
      rankings_not_open: "Rankings are not open yet.",
      votes_need_review: "Review held votes before freezing this week.",
      insufficient_audience:
        "No eligible title has enough reported audience yet.",
      snapshot_stale:
        "Activity eligibility changed. Reject this snapshot and prepare the week again.",
      already_decided: "Another moderator decided this snapshot. Refresh.",
      competition_not_closed:
        "Close the week after its end time before preparing scores.",
      access_required: "Use the protected administrator site.",
    }[code] || "Rankings are unavailable. Please retry."
  );
}
