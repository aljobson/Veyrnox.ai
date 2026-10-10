"use client";
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
const labels = {
  qualified: "Your choice is counted.",
  under_review: "Your choice is awaiting review.",
  rejected: "Your choice was excluded by moderation.",
};
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
            ? "Create an active Cinema profile to answer story polls."
            : "Story polls are unavailable right now. Please retry.",
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
      setNotice(labels[result.status] || "Choice recorded.");
      await load();
    } catch (e) {
      if (e.code === "choice_already_recorded" || e.code === "poll_closed")
        await load();
      setError(
        {
          choice_already_recorded:
            "You have already answered this poll. Your original choice is kept.",
          poll_closed:
            "This poll has closed. New answers are no longer accepted.",
          profile_required:
            "Create an active Cinema profile to answer story polls.",
          account_not_active:
            "Your Cinema account is unavailable. Contact support.",
          rate_limited: "Too many requests. Wait a minute and retry.",
        }[e.code] ||
          "Your choice was not confirmed. Retry to check the same answer.",
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
        Story choices
      </h2>
      <p className="mt-2 text-sm text-vx-fg-muted">
        Choose where the story goes next. One answer per account in each open
        poll. Choices are free and cannot be changed after submission.
      </p>
      {!account && (
        <button
          className="mt-3 underline"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("veyrnox:auth-required"))
          }
        >
          Sign in to choose
        </button>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm">
          {error}{" "}
          <button className="underline" onClick={load}>
            Refresh story polls
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
          Loading story polls…
        </p>
      )}
      {data?.polls?.length === 0 && (
        <p className="mt-3 text-sm text-vx-fg-muted">
          No story polls for this episode yet.
        </p>
      )}
      {data?.polls?.map((poll) => (
        <article key={poll.id} className="mt-4 rounded-xl bg-vx-panel p-4">
          <h3 className="font-bold">{poll.question}</h3>
          <p className="mt-1 text-sm">
            {poll.is_open ? "Closes" : "Closed"}{" "}
            {new Date(poll.closes_at).toLocaleString()}
          </p>
          <form onSubmit={(event) => choose(event, poll)} className="mt-3">
            <fieldset
              disabled={!!busy || !account || !!poll.my_choice || !poll.is_open}
            >
              <legend className="text-sm">Choose one answer</legend>
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
                    <span data-testid={`story-choice-count-${option.id}`}>
                      {option.votes}
                    </span>{" "}
                    counted {option.votes === 1 ? "answer" : "answers"}
                  </span>
                </label>
              ))}
            </fieldset>
            {poll.my_choice ? (
              <p className="mt-3 text-sm">{labels[poll.my_choice.status]}</p>
            ) : (
              account &&
              poll.is_open && (
                <button
                  type="submit"
                  disabled={!!busy || !selected[poll.id]}
                  className="mt-3 rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50"
                >
                  {busy === poll.id ? "Recording…" : "Submit story choice"}
                </button>
              )
            )}
          </form>
          <p className="mt-3 text-xs text-vx-fg-muted">
            Answers held for review are excluded until approved. Story choices
            do not contribute to competition rankings.
          </p>
        </article>
      ))}
    </section>
  );
}
