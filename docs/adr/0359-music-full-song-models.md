# ADR-0359 — Music full-song models (MiniMax Music 2.0 first, Lyria 3 Pro standby)

Status: Proposed 2026-11-19. Nothing in this ADR is built, priced for sale, applied or switched on. Every
decision marked **D** below needs the owner's word before its phase starts.

## Context

Music runs only on ACE-Step (`fal-ai/ace-step`, `fal-ai/ace-step-1.5`). It returns clips of 10-60 s in a
Create flow that quotes first, then debits two takes. A 2026-11-19 listening spike (the owner's own production
fal key, about $1.20 at list price for the comparison, rated by ear by the owner, first rounds blind) compared
it with two hosted models that return whole songs with sung vocals:

| Model (fal endpoint) | Owner score | Cost per song | Length returned |
|---|---|---|---|
| Lyria 3 Pro (`fal-ai/lyria3/pro`) | 4.5 rock, 4.25 instrumental dance | $0.08 | 105-178 s |
| MiniMax Music 2.0 (`fal-ai/minimax-music/v2`) | 4, 4, 4 (pop, rock, rap) | $0.03 | 45-222 s |
| ACE-Step base (`fal-ai/ace-step`), 180 s requested | 2.5 | $0.0002/s | 60 s, or 180 s on request |

Findings that shape the design: ACE-Step returns 180 s when asked, so the 60 s cap is ours (catalog and
`tokens.js`), not the model's. MiniMax chooses its own length and takes 76-159 s per call (ACE-Step about
15 s). Lyria's fal content checker refused 2 of 5 harmless prompts, and every Lyria track carries a SynthID
watermark. A Sonauto endpoint returned 404. `ace-step-1.5`, our paid model, was not part of the spike.
Scores are one listener on unmatched prompts: a lean, not a measurement.

Output rights are **not confirmed** for any of the three. fal's terms (§4(a)) grant access "for your own
personal or internal business use", say nothing on output ownership, and §14 defers to third-party model
terms. MiniMax's API terms publish no explicit commercial grant and (per a secondary source) let MiniMax use
inputs and outputs to improve its services. Google publishes no output-licence page for Lyria 3 Pro. The
owner chose not to ask fal in writing. Music already resells ACE-Step output that way, so this is not a new
kind of risk, but it is a larger one for a model whose output is what the user pays for.

## Decision

1. **D1 Build dark, decide later.** The work ships behind a new `fullSong` key inside the existing
   `MUSIC_RUNTIME_FLAGS` JSON (absent = off; no new Worker binding, no new var). The catalog row ships
   `active = false`. The owner records the basis for resale rights here (an amendment) before the flag turns
   on. No audio from the spike is used on any public surface until then.
2. **D2 MiniMax first.** One model per row, so a swap to MiniMax Music 2.6 (a newer model, $0.15 on fal) is a
   catalog change, not a rewrite. Lyria 3 Pro is a second row after the content-checker refusals are
   understood; it is not in the first release.
3. **D3 Paid plans only at first**, through the existing `private.music_paid_plan_active` gate re-checked at
   quote and at submit, as `ace-step-1.5` does.
4. **D4 Price from the margin rule.** MiniMax costs $0.03 a take, close to `ace-step-1.5`'s $0.036 at 3
   Credits, so 3 Credits a take (6 for the pair) keeps today's margin. This is derived, not measured: no fal
   invoice has been read for MiniMax, and the ace-step-loop probe billed more than its list price (ADR-0347
   amendment 1). The price is set only after a STAGING probe and the bill.
5. **D5 No length control.** The model decides; the form says "about 1-4 minutes" and hides the duration
   slider for these models. Styles are 10-300 characters and lyrics 10-3000, validated at the boundary.
   Instrumental sends `[Instrumental]` (it worked in the spike).
6. **D6 Edit actions keep their 120 s source cap.** Extend, Cover, Stems and Target stems read at most 120 s.
   A longer song keeps the free local actions (crop, reverse, fade, speed, WAV/FLAC) and shows why the paid
   ones are unavailable, or is trimmed on store. Decided per action in phase 5, not silently.
7. **D7 One pair per generation, as today.** Two provider calls, one debit each, each refundable alone. A
   provider refusal or a call that outlives the stale-job sweep refunds that take and nothing else.
8. **D8 Lyric helper later.** "Write lyrics for me" in Simple mode is a separate phase and a separate price
   (a Chat-priced reply), shown for edit before any Credit is spent.

## What changes

- A migration (next free number on `main` at the time; check open PRs) that inserts the catalog row inactive,
  widens the `provider_endpoint` CHECK on `music_generation_quotes`, and redefines `music_create_quote` and
  `music_submit_pair`, whose model CASE is hard-coded in SQL (0469). Revoke and grant by full signature;
  assert an exact ROW_COUNT on any catalog UPDATE.
- A new `lib/musicFullSong.js` for validation and quote shaping; `lib/musicBackend.js` is already over the
  500-line rule and takes no new logic. Entries in `modelCapabilities.js` and `fallbackModelCapabilities.js`.
- `falWebhookHandler.js` needs no new copy path (MP3 passes through); duration is recorded for phase 5.
- Web and mobile Create show the model, the wait state and the edit-cap rule.

## Not decided / not verified

Resale rights (D1). The price (D4). Whether MiniMax Music 2.0 stays available (one source calls it legacy).
Quality across more than five scored files. `ace-step-1.5` quality. Whether the stale-job sweep timeout
exceeds 3 minutes. Where a 222 s song's Stems and Cover requests fail today.

## Consequences

If rights are never confirmed the code stays dark at a small carrying cost. If MiniMax is retired the row is
swapped. Songs are far longer than anything Music stores now, so R2 storage and the 120 s edit rule (D6) are
the first things to watch after activation.
