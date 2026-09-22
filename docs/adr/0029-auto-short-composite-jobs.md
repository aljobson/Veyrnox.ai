# ADR-0029 — Auto Short: one priced job that orchestrates several provider calls

**Status:** Accepted 2026-09-22 (owner: "go with recommendation")
**Related:** [Auto Short spec](../auto-short/SPEC.md), [ADR-0020](0020-kie-and-openrouter-providers.md) (kie.ai and OpenRouter), [ADR-0027](0027-model-capability-registry.md) (capability registry), [ADR-0014](0014-floor-pricing.md) (price floor), CLAUDE.md "Money & billing"

## Context

The owner wants a "topic in, finished short out" feature, modelled on
[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) (MIT,
Python). That tool writes a script with an LLM, splits it into scenes, gets
footage per scene (stock or AI), adds a voiceover and subtitles, and joins
everything with ffmpeg.

Every product today is **one catalog row, one provider call, one `jobs`
row**. The debit, the webhook, the R2 copy and the refund all assume that.
An Auto Short needs four or more provider calls whose outputs feed the
last one, and it has to be charged as a single purchase.

MoneyPrinterTurbo cannot run in the Worker. It depends on Python, moviepy,
ffmpeg and local files.

## Decision

1. **Rebuild the pipeline on our stack. Do not host MoneyPrinterTurbo.**
   We port its script and scene-splitting prompts, with MIT attribution in
   the source. Running it as a container would add a Python service whose
   API has no auth of its own. It would also mean a second provider-key
   store, and would keep none of the ledger guarantees.

2. **One catalog row, one debit.** `auto-short-32s` is a normal
   `model_catalog` row. Its `credits_5s` is the whole price and is
   normative, as for every row. It is set in a migration from the measured
   cost of its steps, and it must clear the ADR-0014 floor. The app never
   adds up step prices.

3. **A parent `jobs` row and a new `job_steps` table.** The parent carries
   the debit, the idempotency key, the state the user sees, and the final
   asset. Each provider call is a `job_steps` row with its own step kind,
   provider, `provider_job_id`, state and R2 output key. The step's parent
   `user_id` is the only owner; webhooks never trust a payload's user.

4. **Webhooks advance the pipeline.** A step's completion comes through the
   existing signed webhook and `webhook_events` dedupe. It is matched to a
   `job_steps` row by `provider_job_id`, and then the next step is
   submitted. The existing sweep also re-drives any step that has been
   stuck past its timeout, so a lost callback cannot strand a paid job.

5. **All-or-nothing refunds.** If any step fails after retries, the whole
   debit is refunded through `ledger_refund`, and provider spend already
   incurred is ours. Partial refunds would need per-step prices in the app,
   which decision 2 forbids.

6. **v1 uses AI clips only**, from the cheapest verified video row
   (currently `veo-3.1-lite-kie`: 8s, $0.15). Stock footage (Pexels,
   Pixabay) is out: it adds a vendor, a licence notice on every result, and
   a separate moderation path.

7. **The stitch step needs a verified provider before anything ships.**
   The candidate is fal's hosted ffmpeg (`fal-ai/ffmpeg-api/compose`). It is
   listed in fal's index but has never been called by us. If it cannot mix
   the clips, the voiceover and captions into one MP4, the fallback is a
   Cloudflare Container running ffmpeg. That fallback needs its own ADR.

8. **Ship behind `localStorage.veyrnox_auto_short`** until the migration
   has landed and reconciliation has run clean for 24 hours (CLAUDE.md
   "Delivery").

## Consequences

- The ledger stays one debit and at most one refund per purchase, so
  `reconcile_balances()` needs no change.
- Every webhook handler gains one lookup, `job_steps` by `provider_job_id`,
  used when no `jobs` row matches.
- A failed short costs us up to about $0.70 of provider spend with no
  revenue. The spec caps retries and puts the cheapest step first.
- The capability registry (ADR-0027) needs records for the LLM, TTS and
  ffmpeg endpoints before they can be called, the same as any model.
- **Nobody can buy credits** until the billing provider replaces
  LemonSqueezy, which refused AI media generation on 2026-09-22. At about
  110 credits a short, free-credit users (50) cannot afford one. This
  feature does not launch before billing does.

## Alternatives rejected

| Option | Why not |
|---|---|
| Host MoneyPrinterTurbo as a container | Python service to run, an open API behind a token, a second key store, no ledger integration, and its AI-video step goes through MuAPI, a brand retired in ADR-0007 |
| Run the steps in the browser | The client would hold provider URLs and could skip steps; the price would no longer be server-side |
| Charge each step as a separate job | The user sees four charges for one product, and a failure half-way leaves a paid, useless clip |
| Stock footage in v1 | New vendor, licence notice on every result, separate moderation; defer until AI-only is proven |

## Owner decisions (2026-09-22)

1. **Price:** 110 credits for 32 seconds (four 8s scenes). The activating
   migration re-checks it against the measured cost and the ADR-0014 floor.
2. **Voice:** ElevenLabs Turbo 2.5 (`fal-ai/elevenlabs/tts/turbo-v2.5`). It
   returns word timings, which the captions need.
3. **Captions:** a WebVTT file built from the word timings in v1. fal's
   compose schema has only video, audio and image tracks, with no text track
   and no volume control, so it cannot burn captions in. Burned-in captions
   are a follow-up if slice 0 shows a way.
4. **Format:** vertical 9:16 only in v1.

## Amendment (2026-09-22): the Clip Editor uses `job_steps` too

**Status:** Proposed. Accepted when the owner merges the PR that carries it.
**Related:** [Clip Editor PRD](../editor/PRD.md), migration 0092, #235.

The Clip Editor (stitch, trim, add audio) is the second product built on
this ADR. It reuses decisions 2 to 5 unchanged, with these additions:

1. **One more priced row, same rule.** `clip-edit` is one catalog row at
   1 credit per started 5 seconds of *output*. The gateway prices it from
   the edit's output length, which it measures from the source files, never
   from a number the client sends. The app still never adds up step prices.

2. **Steps run one at a time.** An edit's steps (a trim per cut clip, then
   one merge, then optional audio) are submitted strictly in order, each by
   its predecessor's webhook. Only one step is ever in flight, so two
   callbacks cannot race to submit the next one. `job_steps` has no claim
   yet (raised on #230). Any product that runs steps in parallel needs that
   claim first.

3. **Decision 7's `compose` does not suit the editor.** Slice 0 of the
   editor (PRD §9) found that `fal-ai/ffmpeg-api/compose` ignores clip
   durations and stretches mixed aspect ratios. The editor instead chains
   the three endpoints that hit their timings exactly: `trim-video`,
   `merge-videos` and `merge-audio-video`. Mixed aspect ratios are refused
   before the debit.

4. **Inputs are the caller's own Assets.** A clip or soundtrack is named by
   the id of the job that made it, and is resolved through
   `get_user_asset`, which enforces ownership. The stored edit on the parent
   job holds our R2 keys and the measured lengths, and every step callback
   rebuilds the plan from that row, never from a provider payload.

5. **Each step's output is copied to R2** under the parent job before the
   next step reads it through a fresh presigned URL. So a retry never
   depends on how long fal keeps its own files.

6. **Step endpoints get no capability records,** as for Auto Short's stitch.
   The orchestrator is the only caller, with fixed inputs; the sellable
   contract is the `clip-edit:v1` record the gateway checks.

The editor ships behind `localStorage.veyrnox_editor` under decision 8's
rule, with the `clip-edit` row inactive until then.
