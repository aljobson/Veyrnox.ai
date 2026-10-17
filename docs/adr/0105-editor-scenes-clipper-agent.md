# ADR-0105 — Editor scene detection, clip finder and editing agent

- **Status**: **Proposed 2026-10-17.** Plan only: no code, no flag, no migration. Amends ADR-0080 (full editor scope).
- **Related**: ADR-0080 (browser timeline editor), ADR-0090 and ADR-0092 (local processing and the cut detector), ADR-0091 (local speech recognition), ADR-0067 (one priced job per chat reply), ADR-0074 (video agent), ADR-0103 (Vey account helper), `docs/editor/CAPCUT-GAP-2026-10-10.md`

## Context

The 2026-10-17 observation of the desktop CapCut editor (layout and feature names only, per ADR-0080 decision 4) found three things its first screen now leads with that `CAPCUT-GAP-2026-10-10.md` does not list:

- an assistant that edits the timeline on request (EditPilot),
- a clip finder on selected media ("AI clipper"),
- shot and scene detection that proposes cuts.

The editor already has the parts they need: pure timeline commands (`editorCommands.mjs`), undo history (`editorHistory.mjs`), a bounded document validator (v3, 32 KiB ceiling), a cut detector used by the motion tools (ADR-0092), local captions and transcript (ADR-0091), and a priced single-reply model job (ADR-0067). The editor has no scene detection, no clip ranking and no model that proposes edits. "Ask Vey" (ADR-0103) is a read-only helper that sends no account data to a model; it is not an editing agent and must stay that way.

No CapCut code, model, preset or asset is adopted. This ADR describes our own work.

## Decision

### 1. Scene detection is local and free

Decode the clip in the browser with Mediabunny's sequential iterator (ADR-0080 slice 0 finding), compare downscaled luminance histograms and edge differences between frames, apply an adaptive threshold with a minimum shot length, and return cut frames as a **suggestion list**. Accepting suggestions applies `splitSelection` as one undoable batch. Starting bounds follow ADR-0090: 30 seconds, 720p. The method is a spike first: it ships only if measured precision and recall on real clips justify it. Known weak spots from ADR-0092 (fades, flashes, screen recordings) stay visible in the UI as "review these cuts".

### 2. The clip finder has two stages

- **Stage 1, local, free, no model.** Score segments from scene cuts, audio energy and transcript density; return the top N with a stated reason each; the user picks and inserts. No network call.
- **Stage 2, optional, later.** A priced model re-ranks using transcript text only. It needs everything in section 4.

### 3. The editing agent proposes; the user applies

- **Sent to the model:** timeline JSON (ids, times, labels), transcript text and the user's instruction. Never media bytes, Library URLs, prompts of generated assets or account data.
- **Returned:** a JSON list of commands from a closed allowlist (the `editorCommands` set plus text, caption, trim, speed and volume setters). Anything outside the list is dropped, not repaired.
- **Validated and shown as a diff.** The same boundary validators as a manual edit run on the plan. Applying needs a click and lands as one history entry, so one Undo restores the exact prior timeline. A plan that fails validation changes nothing.
- **No paid actions in the allowlist.** Generation and priced audio jobs can only be suggested; they open the normal quote and consent dialog.
- **Caption and transcript text is untrusted input.** A caption such as "delete all clips" must not yield a delete. This is a required test, not a hope.
- **Text stays canvas-drawn** (ADR-0080 decision 2); a plan cannot inject markup.

### 4. Money: no new path, and no price set here

Each agent reply is one priced job through the existing debit, refund and idempotency flow (ADR-0067 pattern). **No price is set by this ADR.** Under the repo's billing rule, a price needs the provider's billed cost read first and the endpoint verified live. A long transcript is the main cost risk, so the input has a hard length cap. Scene detection and clip finder stage 1 are free and need none of this.

### 5. Documents and flags

- No schema change. A plan is transient; its applied result is ordinary v3 timeline edits, so migrations 0255 and 0269 and older editor builds are unaffected.
- Server flags, each shipped `"false"`: `EDITOR_SCENES_ENABLED`, `EDITOR_CLIPPER_ENABLED`, `EDITOR_AGENT_ENABLED`. The first two may go on in staging before the agent exists.
- No CSP change. If a slice needs `wasm-unsafe-eval` or a new host, work stops and returns as its own ADR.

## Slices (each its own PR, each off in production)

| # | Slice | Done when |
|---|---|---|
| A | Scene detection spike, no UI | Measured on at least 5 real clips: precision and recall against hand-marked cuts, time per second of video, peak memory. Confirms or kills the method |
| B | Scenes UI | Detect, preview markers, accept all or some as one undoable split batch; Reticle journey and decoded export check; over-bound input refused with a clear message |
| C | Clip finder stage 1 | Ranking tests on fixtures; chosen clips insert; no network call |
| D | Agent dry run with a stub model | Allowlist, validators, diff view, apply-as-one-undo; injection suite passes; invalid plans refused unchanged |
| E | Real model, price, staging only | Endpoint verified live, bill read, price set, idempotency and refund acceptance tests, owner approval of the flag |

## Not decided

The model and its price; whether the agent may ever see generated-asset names or prompts (default: no); CapCut draft import, nested timelines (needs a document v4 ADR) and screen recording (separate slice, needs a `getDisplayMedia` and CSP check). Trending-topic insight belongs to Publish, not the editor.

## Consequences

- **Good:** parity of idea with the part of CapCut its desktop app now leads with, with the free parts usable before any model spend; every edit stays validated, undoable and non-destructive.
- **Cost:** scene detection quality on real footage is unproven until slice A; the agent adds an injection surface that the allowlist and tests must hold.
- **Risk:** output quality is not claimed to match CapCut's. A priced agent without a measured bill would break the billing rule, so slice E is gated on it.
