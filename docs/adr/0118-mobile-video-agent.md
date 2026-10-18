# ADR-0118 — Mobile: Video from a brief (the video agent)

**Status:** Proposed 2026-10-18
**Related:** [ADR-0074](0074-openmontage-video-agent.md) (the agent, its plan ticket and gates), [ADR-0029](0029-auto-short-composite-jobs.md), [ADR-0114](0114-mobile-create-with-files.md), [ADR-0106](0106-mobile-app.md), roadmap slice M10b

## Context

`video-agent` is priced and run in two steps: `POST /api/v1/montage/plan` makes a plan and a signed 30-minute ticket without charging, and approving is an ordinary `POST /api/v1/generations` that carries the ticket and the idempotency key it names. The app hid the model because it takes `brief` and `plan_id`, not a prompt.

## Decisions

1. **No server change, no dependency.** The app uses the two routes as they are.
2. **A Video from a brief screen** (`/create/agent`), listed at the top of the Video tab only when the catalog lists the agent and it is not gated, with the catalog price as "from N credits".
3. **Brief, then plan, then approve.** The person writes 3 to 500 characters and picks 9:16, 16:9 or 1:1. "Make a plan (free)" calls the plan route once; it is never retried by the app, because planning can cost the server a model call and shares the generation rate limit.
4. **The review shows what the server says**: its summary, its price in Credits, the format and how long the plan lasts (30 minutes, counted down from the server's `expires_at`). The app never works out a price. Approve is off once the plan has run out.
5. **Approve** sends the plan's own idempotency key, `confirmed_credits` equal to the server price, and `{brief, plan_id, aspect_ratio}`. There is no consent field because no file is sent. A retry of the same approve reuses the key, so it is charged once. The server refuses a changed brief, another account's ticket, an expired plan or a moved price before any charge.
6. **In flight survives leaving.** After a successful approve the app opens the existing job screen with the job id; that screen keeps watching and the creation reaches the Library either way. A second attempt while one is being made answers `video_agent_in_progress`, which the screen words as "you already have one being made" with a link to the Library.
7. **Plain errors**, all with "you were not charged" where true: agent not available, planner offline, every slot busy (with the server's wait), plan ran out, price changed, plan no longer matches (plan again), too many requests, not enough credits.

## Not decided here

- Spoken narration (`narration_text`): the server only says whether it is supported after planning, so v1 sends none.
- Showing the planned length when the server gives none; the summary text carries it.
- Film Studio (the seven-stage web workspace) is a different product and is not part of this.

## Consequences

- The approve step is covered by unit tests, not by a live run: a run costs 165 Credits of real provider spend.
- No new native module.
