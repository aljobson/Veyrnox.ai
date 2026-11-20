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

## Amendment 1 (2026-11-19, spike rounds 2-3)

Status: Proposed. Changes the order of work, not the dark-by-default rule. Nothing here is built or priced.

**New evidence.** The spike's first baseline was the wrong model: it ran base `fal-ai/ace-step`, not the paid
`ace-step-1.5` that Music sells. The owner then rated `ace-step-1.5` by ear (FLAC results converted to MP3 to
play; one listener, five files generated, two rated):

| Model | Scored files | Scores | Cost per song at list |
|---|---|---|---|
| Lyria 3 Pro | rock, instrumental dance | 4.5, 4.25 | $0.08 |
| ACE-Step 1.5 | pop 60 s, ballad 180 s | 4.0, 4.0 | $0.036 at 60 s, $0.108 at 180 s (0.0003/s, doubled for thinking) |
| MiniMax Music 2.0 | pop, rock, rap | 4.0, 4.0, 4.0 | $0.03 |
| ACE-Step base | 3-minute ballad | 2.5 | $0.036 at 180 s |

`ace-step-1.5` returned a full 180 s song when asked, scored the same as MiniMax, and is already sold,
quoted, refunded and webhook-handled. The 60 s ceiling is ours (`fixed: { duration: 60 }` in
`modelCapabilities.js`, the `'duration', 60` payload in 0469, and the 60 s label in `tokens.js`), not the
model's. Three of the five 1.5 files (rock, rap, instrumental dance) are unrated, so this is still two data
points, not a measurement.

**Revised decisions** (D1, D3 and D5-D8 stand unchanged; D2 and D4 are replaced):

- **D2' Lead with longer `ace-step-1.5`.** Phase one lifts the 60 s cap for `ace-step-1.5` instead of adding a
  supplier: a duration input at quote time, validated against a stated ceiling (the spike proved 180 s), a
  quote and submit path that carries the duration instead of the literal 60, and the UI and capability entries
  updated. No new catalog model row, no new provider endpoint, no new licence question beyond what Music
  already carries for ACE-Step. A later migration may already carry a duration for `ace-step-1.5` (0531 shows
  Custom quotes for it); verify before writing the first one.
- **D2'' MiniMax Music 2.0 is the cheaper long-form option, built second** and only if the price per minute
  matters: $0.03 a song against $0.108 for 180 s of ACE-Step 1.5, a 3.6 times gap at list price. Lyria 3 Pro
  stays the premium tier after the content-checker refusals are understood.
- **D4' Price per second, not per take.** Credits for a longer take scale with duration at the existing
  ratio (3 Credits at 60 s covers $0.036), so a 180 s take is about 9 Credits and a pair about 18, before any
  change to margin. The price is set only after a STAGING probe and a read of the fal bill; the
  `ace-step-loop` probe billed above list (ADR-0347 amendment 1), so the list rate is a floor.
- **D6 sharpens.** A 180 s ACE-Step 1.5 song is above the 120 s edit cap for Extend, Cover and Stems. Decide per
  action whether to trim on store or disable with a reason; the free local actions are unaffected.

**What this removes from the plan.** The new catalog row, the new provider endpoint branch in
`music_create_quote` and `music_submit_pair`, and the new `lib/musicFullSong.js` validation module move to the
MiniMax phase. The first phase is a duration change on an existing path, which still touches the money spine
(quote total, debit amount, refund per take) and still needs the same inspection and acceptance tests.

**Not decided / not verified.** The duration ceiling to ship (180 s proven, longer untested). Price. Whether
pair debits of 18 Credits suit the current plans. Quality of the three unrated 1.5 files, and of 1.5 across
more prompts. Resale rights (D1) are unchanged: unconfirmed, and the owner declined to ask fal in writing.

## Amendment 2 (2026-11-19, C3 web price display)

Status: Accepted by the owner ("go with recommendation"). Applies to the web Create form for long songs.

The duration slider does not show credit figures. When the server advertises 60-second price steps
(`controls.duration_price_block_seconds`), the form says in words that the price grows in 60-second steps and
that the quote shows the exact price before any Credits move. The reviewed quote, priced in SQL from the catalog
(0563), is the only price shown and the only one that moves Credits. Showing per-length credit figures in the
browser would mean computing a price in the app layer, which the project rules forbid; if figures are wanted
later, they must come from the database (for example a quote or a SQL-projected tier list), not from client math.

## Amendment 3 (2026-11-19, C4b editable long-song ceiling)

Status: Accepted by the owner. The requested "Cap at 140 s" meant the longest duration that fits the
existing WAV conversion limit; review corrected that ceiling to **135 s**. The `longSongs` runtime switch
stays off. Migration 0563 is already applied to production; migration 0567 lowers its ceiling when applied.

All five ACE-Step 1.5 spike files report **48,000 Hz, stereo, 16-bit** in FLAC STREAMINFO, not 44.1 kHz.
The webhook converts FLAC to WAV through `lib/flacToWav.js`, whose `FLAC_TO_WAV_MAX_OUTPUT_BYTES` is
25 MiB (26,214,400 bytes). Music's edit and render paths read WAV only. At 192,000 PCM bytes per second,
140 s needs 26,880,000 bytes before the WAV header and exceeds the cap. A measured 180 s take
(18.1 MB FLAC, 34.6 MB WAV) is refused by the converter; `r2Copy.js` then stores the original FLAC,
which those edit and render paths cannot read. A 60 s take converts in 0.84 s.

135 s needs 25,920,000 PCM bytes plus the 44-byte WAV header, below the cap, and fits the slider's
5 s step. With `longSongs` enabled, Simple and Custom accept 10..135 s for `ace-step-1.5`; 136..180 s
is rejected in both the app and SQL. Other models and every request of 60 s or less are unchanged.
The new migration fails loudly before replacing the CHECK if any prompt snapshot already exceeds 135 s;
it never truncates or rewrites such snapshots.

Pricing remains `credits_5s * ceil(duration_seconds / 60)` per take, authoritative in SQL. At the current
3-Credit catalog unit, the tiers are 10-60 s = 3 Credits per take (6 per pair), 61-120 s = 6 (12 per pair),
and 121-135 s = 9 (18 per pair). Submit and refund behavior are unchanged. This amendment does not raise
the WAV cap, change the 120 s paid-edit rules, add mobile behavior, enable the switch or authorize fal spend.

## Amendment 4 (2026-11-19, STAGING probe at 135 s)

Status: Measured. Records the pre-activation probe; the production `longSongs` switch stays off until the owner
turns it on.

**Setup.** Staging database: 0563 and 0567 applied by hand (names = file stems). Staging Worker built from `main`
with `"longSongs": true` in the staging `MUSIC_RUNTIME_FLAGS` only. One Simple pair (instrumental) and one Custom
pair (original lyrics, vocal) at 135 s on `ace-step-1.5`, from a paid-plan staging account.

| Measure | Result |
|---|---|
| Quote, both modes | 2 versions x 9 Credits = 18 per pair, as 0563/0567 price it |
| Debits | Four ledger rows of -9; balance 995 -> 959; `reconcile_balances`, `reconcile_free_credits`, `reconcile_subscription_credits` returned zero rows |
| Payload sent to fal | `duration: 135` (set by the dispatch trigger from the prompt snapshot); Custom carries the lyrics |
| fal turnaround | 2 min 51 s to 3 min 43 s from dispatch to webhook (staging's dispatch sweep added about 3.5 min before that) |
| Webhook | Four HTTP 200s, 5.6-12.8 s wall time and 1.8-2.8 s CPU each, FLAC -> WAV included |
| Stored file | `audio/wav`, 25,920,044 bytes each (44-byte header + 135 s x 192,000 bytes), under the 25 MiB conversion cap |
| Playback | Plays in the library at 2:15 |
| Edit actions | Cover, Isolate one instrument, Add a section and Extend disabled with "up to 2 min"; Replace "up to 60 s"; Crop refused with "too large to crop here (files over 20 MB)"; whole-song Stems is not offered |
| fal bill | Each request 270 units x $0.0003 = $0.081 (135 s, doubled for thinking): list price, nothing above it |

**Price.** The bill equals the list rate, so the 0563 tiers stand: 9 Credits a take covers $0.081 at 135 s and
$0.0726 at 121 s, the same or better margin than 3 Credits at 60 s ($0.036). No price change is proposed.

**Known limits, unchanged.** Songs over about 109 s cannot be cropped or rendered (20 MiB WAV inspection cap) and
paid edits stop at 120 s, as accepted in Amendment 3. Whole-song Stems (`mureka-stems-v3`) accepts only MP3 up to
10 MiB in SQL (0480/0551), so it never runs on any `ace-step-1.5` take, at any length; this predates long songs.
Resale rights (D1) remain unconfirmed.
