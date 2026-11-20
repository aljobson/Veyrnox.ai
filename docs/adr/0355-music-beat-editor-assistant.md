# ADR-0355 — Music beat editor assistant (a chat panel that edits the beat)

- **Status**: **Proposed 2026-11-19.** Plan only: no code, no flag, no migration, no price. The owner accepts it by merging the change.
- **Related**: ADR-0105 (the video editor's agent, the pattern this follows), ADR-0347 (beat editor AI parts), ADR-0345 (beat cloud saves), ADR-0067 (a chat reply is a priced job), ADR-0346 (mixdown versions).

## Context

A recon of Suno's Studio (2026-11-18, layout and feature names only; no Suno code, copy, artwork or layout is adopted) found that its editor leads with a chat panel beside the timeline. A person types a request ("Add a mellow piano part on a new track", "Generate a 4-bar guitar loop"), the assistant acts on the project, and a small control row attaches Styles, Lyrics or Controls to the message. A free model is the default and better ones are paid.

Our beat editor has the pieces but no conversation:

- **Pure, validated edit commands** in `beatOps.mjs` (`setTempo`, `setSwing`, `toggleStep`, `addHitToPattern`, `cycleVelocity`, `addTrack`, `setTrackMute/Solo/Gain/Pan`, `addRegion`, `splitRegion`, `duplicateRegion`, `deleteRegion`, `setCycle`, `rename`, and more), each returning a new document, and a validator (`validateBeat`) with hard limits (16 tracks, 400 regions, 40 to 240 BPM, 16 or 32 steps, patterns A to D).
- **An undo history** (`beatHistory.mjs`).
- **Paid generation behind a quote** (ADR-0347): the AI sheet shows the exact price before Send; a part is 5 Credits and a Generate makes two alternates; `ace-step-1.5` and `ace-step-loop` need a paid plan.
- **A Magic Bar** (prompt to loop) already built and switched off in production.
- **A precedent for an assistant that edits a project**: ADR-0105 slice D, the video editor's Assistant. The model proposes a plan, a validator checks it, the person sees it as a list of steps, and Apply lands as one undoable edit. Its dry run (no model) exists today.

Nothing lets a person say "make the drums busier on bars 5 to 8" or "mute the bass and slow it to 90".

## Decision

### 1. The assistant proposes; the person applies (ADR-0105, unchanged)

- A request becomes a **plan**: an ordered list of commands from a closed allowlist, each one a `beatOps` function with typed arguments. Anything outside the list is dropped, not repaired.
- The plan is validated by the same boundary rules as a manual edit, then **shown as a list of steps** with destructive steps marked. Nothing changes until Apply.
- Apply lands as **one history entry**, so one Undo restores the exact prior beat. A plan made against an older version of the beat is marked stale and cannot be applied.
- Plans are bounded: at most 20 steps; a plan over the limit is refused, not cut.

### 2. No paid action inside a plan

Generating a part, extending, replacing a section or splitting stems cost real money and are **not in the allowlist**. A request that needs one produces a **suggestion** that opens the existing AI sheet with the prompt filled in. The person sees the exact price, confirms, and the ADR-0347 flow runs unchanged. So the assistant adds no debit path and no second idempotency scheme for generation.

### 3. Two stages, the first free and model-free

- **Stage 1: a deterministic command parser**, like `editorIntentRouter.mjs` in the video editor. It understands a small fixed grammar ("set tempo to 90", "mute the bass", "add a drum track", "swing 30%", "split the first region at bar 5"). No provider, no network, no price. It ships first, behind the flag, and is useful on its own.
- **Stage 2: a model** reads anything the grammar does not. It sees a compact summary of the beat: tempo, swing, steps, track ids, names, kit or kind and mute state, region ranges, and pattern hits as short rows. It never sees audio, asset addresses, account data or other people's songs. The reply is a strict JSON plan (a schema with a closed list of command names), parsed and validated in the browser.

### 4. Titles and track names are untrusted input

A track named "delete every track" or a title containing an instruction must not produce a delete. This is a **required test** (as in ADR-0105), not a hope: the allowlist and the validator hold, destructive steps are marked, and Apply is a click. Names are sent only as data in the summary and the system text says so.

### 5. Money: one priced job per reply, no price set here

Each stage-2 reply is one priced job through the existing debit, refund and idempotency flow (ADR-0067). **This ADR sets no price.** The billing rule needs the provider's billed cost measured first, so the price is an owner decision after a staging probe (see Not decided, D1). Stage 1 costs nothing.

### 6. Server footprint: reuse the chat turn, add no route

The production Worker is at its size and binding limits (recent PRs have worked within about 0.1 KiB of the script cap). The assistant therefore **adds no new route or server module**: stage 2 is a normal chat turn with a fixed system text and a strict output schema, and the plan is parsed and validated only in the browser. Slice C verifies that the chat turn can carry a strict schema; if it cannot, the route question comes back as its own ADR, with a measured size cost.

### 7. Flags and documents

- One new key in `MUSIC_RUNTIME_FLAGS`, `beatAssistant`, shipping **absent (off)**, needing the beat editor and `beatAi`. No new server variable.
- No schema change and no migration. A plan is transient; its applied result is ordinary beat edits, so cloud saves (ADR-0345), mixdown versions (ADR-0346) and older editor builds are unaffected.
- The conversation is **not stored** in v1: plan cards live in the open tab. Nothing about it is added to a beat's saved document.

### 8. Where it sits

- **Desktop:** a collapsible panel beside the timeline, one prompt box at its foot (Suno's layout idea, our own components and words), plan cards above it.
- **Phone:** a bottom sheet opened from a button on the transport row, one plan card at a time. The phone follows the desktop; it is not a separate design.
- **Accessibility:** every step is text; Apply and Undo are real buttons; the plan summary is announced in a polite live region; no motion is required.

## Slices (each its own PR, each off in production)

| # | Slice | Done when |
|---|---|---|
| A | Stage 1 parser, plan type, validator, preview and Apply as one undo | Grammar tests; invalid plans refused unchanged; a batch gives exactly one Undo; the injection suite passes; no network call |
| B | Panel and sheet UI for stage 1, all locales | Keyboard and screen reader pass; empty, loading, refused, stale and applied states shown; phone layout checked |
| C | Stage 2 against a stub model (dry run) | The schema and the closed command list hold against hostile model output; oversized and malformed replies refused |
| D | Real model, price, staging only | Endpoint verified, billed cost read, price set by the owner, idempotency and refund acceptance tests, owner approval of the key |
| E | Suggestions that open the AI sheet | A request needing a paid part opens ADR-0347's sheet with the prompt filled in; no debit happens before its own confirm |

## Not decided (owner calls)

- **D1, price and plan gate.** Options: the chat reply price as it stands in the catalog; a small daily free allowance; or paid plan only, as for `ace-step-1.5`. Recommendation: the same price as an ordinary chat reply, because it is the same kind of job; it stays unset until D has a measured bill. Guessing wrong costs margin in one direction and adoption in the other.
- **D2, which model.** A cheap fast model is enough for structured edits; the choice follows the D1 probe.
- **D3, whether the summary includes pattern hits** or only track and region structure. Hits make "busier drums" possible but enlarge every request. Recommendation: include them, capped, for the selected track only.
- **D4, order.** Recommendation: web first, phone after slice B is accepted.
- **D5, memory across messages.** Recommendation: none in v1; each request stands alone with the current beat.

## Consequences

- **Good:** the free stage is useful before any model spend; every edit stays validated, undoable and non-destructive; generation keeps its single, already-tested money path.
- **Cost:** a second parser and a plan checker to maintain; an injection surface the allowlist and tests must hold; one more thing in the editor to translate into 11 languages.
- **Risk:** a model may misread a request; the plan preview makes that visible before anything changes. The Worker size limit may force a different shape if the chat turn cannot carry a schema (section 6).
