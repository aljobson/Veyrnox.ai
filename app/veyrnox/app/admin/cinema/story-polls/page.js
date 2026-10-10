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
          <StoryPollQueue />
        </AccountBoundary>
      </Main>
    </>
  );
}
function message(code) {
  return (
    {
      recent_mfa_required: "Enter a fresh authenticator code, then retry.",
      not_authorized: "Cinema administrator permission is required.",
      access_required:
        "Open this page through the protected administrator site.",
      story_polls_not_open: "Story polls are not open yet.",
      self_review_forbidden: "You cannot review your own choice or episode.",
      account_not_active: "This voter or title is no longer eligible.",
      poll_capacity: "Close an existing poll before creating another.",
      idempotency_conflict: "This request changed. Refresh and try again.",
      rate_limited: "Too many requests. Wait a minute and retry.",
      invalid_action: "Check the episode ID, question, answers and dates.",
      invalid_poll:
        "Use two to six distinct answers and a valid window of at most 31 days.",
      content_not_found: "Choose an eligible published episode.",
      poll_overlap: "This episode already has a poll in that time window.",
    }[code] || "The request was not confirmed. Retry to check the same action."
  );
}
function StoryPollQueue() {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setBusy(true);
    setError("");
    setData(null);
    try {
      const next = await gatewayFetch("/admin/cinema/story-polls");
      if (version === generation.current) setData(next);
    } catch (e) {
      if (version === generation.current) setError(message(e.code));
    } finally {
      if (version === generation.current) setBusy(false);
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
      <h1 className="mt-5 text-3xl font-black">Cinema story polls</h1>
      <p className="my-5">
        Create a moderator-curated question for a published episode, close
        polls, and review choices held for unusual activity. Story choices do
        not affect competition scores. Each action requires an audit reason.
      </p>
      <MfaPanel requireFresh onVerified={load} />
      <Button className="mt-5" onClick={load} disabled={busy}>
        {busy ? "Loading…" : "Refresh story poll queue"}
      </Button>
      {error && (
        <p role="alert" className="mt-4">
          {error}
        </p>
      )}
      {data && (
        <>
          <h2 className="mt-8 text-xl font-bold">New story poll</h2>
          <ActionForm action="create_story_poll" onDone={load} />
          <h2 className="mt-8 text-xl font-bold">Story polls</h2>
          {data.polls.length === 0 && <p>No story polls yet.</p>}
          {data.polls.map((c) => (
            <article
              key={c.id}
              className="mt-4 rounded-xl border border-vx-border p-4"
            >
              <h3 className="font-bold">{c.question}</h3>
              <p>
                {c.status} · {new Date(c.opens_at).toLocaleString()} –{" "}
                {new Date(c.closes_at).toLocaleString()}
              </p>
              <p className="text-sm">{c.title}</p>
              {c.status === "open" && (
                <ActionForm action="close_story_poll" id={c.id} onDone={load} />
              )}
            </article>
          ))}
          {data.polls.length === 50 && (
            <p className="mt-4">Showing the latest 50 polls.</p>
          )}
          <h2 className="mt-8 text-xl font-bold">Choices awaiting review</h2>
          {data.choices.length === 0 && (
            <p role="status">No choices awaiting review.</p>
          )}
          {data.choices.map((v) => (
            <article
              key={v.id}
              className="mt-4 rounded-xl border border-vx-border p-4"
            >
              <h3 className="font-bold">{v.title}</h3>
              <p>
                {v.display_name} (@{v.username}) ·{" "}
                {new Date(v.created_at).toLocaleString()}
              </p>
              <p>
                {v.question} · {v.label} — held for review.
              </p>
              <ActionForm
                action="review_story_choice"
                id={v.id}
                onDone={load}
              />
            </article>
          ))}
          {data.choices.length === 100 && (
            <p>
              Showing the oldest 100 held choices. Refresh after reviewing to
              load more.
            </p>
          )}
        </>
      )}
    </div>
  );
}
function ActionForm({ action, id, onDone }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef(null);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = { action, reason: form.get("reason").trim() };
    if (id) payload.id = id;
    if (action === "review_story_choice")
      payload.decision = form.get("decision");
    if (action === "create_story_poll") {
      payload.content_id = form.get("content_id").trim();
      payload.question = form.get("question").trim();
      payload.options = form
        .get("options")
        .split("\n")
        .map((o) => o.trim())
        .filter(Boolean);
      payload.opens_at = new Date(form.get("opens_at")).toISOString();
      payload.closes_at = new Date(form.get("closes_at")).toISOString();
      if (
        payload.options.length < 2 ||
        payload.options.length > 6 ||
        payload.options.some((o) => [...o].length > 120) ||
        new Set(payload.options.map((o) => o.toLowerCase())).size !==
          payload.options.length
      ) {
        setError(
          "Enter two to six different answers, at most 120 characters each.",
        );
        return;
      }
    }
    const body = JSON.stringify(payload);
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await gatewayFetch("/admin/cinema/story-polls", {
        method: "POST",
        body,
        headers: { "idempotency-key": attempt.current.key },
      });
      await onDone();
    } catch (e) {
      setError(message(e.code));
      setBusy(false);
    }
  }
  return (
    <form className="mt-4 space-y-3" onSubmit={submit}>
      {action === "create_story_poll" && (
        <>
          <label className="block">
            Published episode ID
            <input
              name="content_id"
              required
              maxLength={36}
              className="mt-1 w-full rounded-lg bg-vx-panel p-3"
            />
          </label>
          <label className="block">
            Opens (your local time)
            <input
              name="opens_at"
              type="datetime-local"
              required
              className="ml-2 rounded-lg bg-vx-panel p-2"
            />
          </label>
          <label className="block">
            Closes (your local time)
            <input
              name="closes_at"
              type="datetime-local"
              required
              className="ml-2 rounded-lg bg-vx-panel p-2"
            />
          </label>
          <p className="text-sm">Maximum window: 31 days.</p>
          <label className="block">
            Question
            <input
              name="question"
              required
              maxLength={240}
              className="mt-1 w-full rounded-lg bg-vx-panel p-3"
            />
          </label>
          <label className="block">
            Answers (one per line)
            <textarea
              name="options"
              required
              rows={4}
              maxLength={726}
              className="mt-1 w-full rounded-lg bg-vx-panel p-3"
            />
          </label>
          <p className="text-sm">
            Two to six distinct answers, at most 120 characters each. Questions
            and answers cannot be edited after publication.
          </p>
        </>
      )}
      {action === "review_story_choice" && (
        <label className="block">
          Decision
          <select
            data-testid={`story-poll-decision-${id}`}
            name="decision"
            required
            className="ml-2 rounded-lg bg-vx-panel p-2"
          >
            <option value="">Choose…</option>
            <option value="qualified">Count choice</option>
            <option value="rejected">Exclude choice</option>
          </select>
        </label>
      )}
      <label className="block">
        Internal audit reason
        <textarea
          data-testid={`story-poll-reason-${action}-${id || "new"}`}
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
      <Button
        data-testid={`story-poll-submit-${action}-${id || "new"}`}
        type="submit"
        disabled={busy}
      >
        {busy
          ? "Saving…"
          : action === "create_story_poll"
            ? "Publish story poll"
            : action === "close_story_poll"
              ? "Close story poll"
              : "Save choice decision"}
      </Button>
    </form>
  );
}
