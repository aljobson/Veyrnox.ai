# Auto Short — spec

- **Status**: Accepted 2026-09-22 — owner took every recommendation (§9)
- **Decision record**: [ADR-0029](../adr/0029-auto-short-composite-jobs.md)
- **Reads with**: [docs/product/](../product/README.md) (app-wide PRD, flow, UI),
  [ADR-0027](../adr/0027-model-capability-registry.md), CLAUDE.md
- **Source of the design**: the script, scene-splitting and composition
  pipeline in [harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)
  (MIT). We port prompts and ordering, not code. Its Python, moviepy and
  MuAPI integration stay behind.

## 1. What it is

The user types a topic, for example "3 facts about octopuses". About two
minutes later they get a 32-second vertical video: four AI-generated
scenes, a voiceover reading a script written for it, and captions. It is
one purchase and one Library item.

**Not in v1:** stock footage, the user's own clips, music, lengths other
than 32s, landscape output, editing the script before rendering, batch
runs, and publishing to TikTok or YouTube.

## 2. Pipeline

```
topic ─► [1 script]  LLM via OpenRouter: title, 4 scene prompts, narration (~80 words)
      ─► [2 voice]   fal ElevenLabs Turbo 2.5: narration ─► MP3 + word timings ─► WebVTT
      ─► [3 scenes]  4 × veo-3.1-lite-kie in parallel: 8s 9:16 720p each
      ─► [4 stitch]  fal-ai/ffmpeg-api/compose: video track (4 clips) + audio track (voice) ─► MP4
      ─► STORED      copy to R2, sha256 at ingest, one asset on the parent job
```

- Steps run in this order so the cheap ones fail first. A bad script or TTS
  error costs cents and is refunded before any clip spend.
- Step 3 fans out: the stitch starts when all four scenes are STORED.
- Veo clips carry their own audio, and compose has no volume control
  (schema: `tracks[] {id, type: video|audio|image, keyframes[] {timestamp,
  duration, url}}`). Slice 0 checks what happens to the clip audio under
  the voice track. If it bleeds through, the scenes need a silent source.
- Each step's output lands in R2 under the parent `job_id` before the next
  step reads it. Providers fetch inputs from short-lived presigned GETs
  (≤15 min), never from another provider's URL.

## 3. Cost and price

| Step | Provider | Est. cost | Verified? |
|---|---|---|---|
| Script | OpenRouter (small model) | ~$0.01 | no |
| Voice | fal TTS, ~80 words | ~$0.02–0.05 | no |
| Scenes | 4 × kie Veo 3.1 Lite | $0.60 | **yes** (2026-09-21) |
| Stitch | fal ffmpeg compose | unknown | **no, blocking** |
| **Total** | | **~$0.65–0.70** | |

Proposed price: **110 credits**. That is the same credits-per-dollar ratio
as Veo Lite (23 cr for $0.15), rounded up. It is set in the activating
migration once every step has a verified cost, and it must clear ADR-0014.
The app never computes it.

## 4. Data

One new table. No change to `jobs`, `ledger_entries` or `credit_balances`.

```sql
create table if not exists public.job_steps (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs(id),
  step            text not null check (step in ('script','voice','scene','stitch')),
  ordinal         smallint not null default 0,          -- scene 0..3
  provider        text not null,
  provider_endpoint text not null,
  provider_job_id text,
  state           text not null default 'PENDING'
                  check (state in ('PENDING','SUBMITTED','STORED','FAILED')),
  attempts        smallint not null default 0,
  output_r2_key   text,                                  -- random UUID key under the job
  output_text     jsonb,                                 -- script step only
  error_code      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (job_id, step, ordinal)
);
create unique index if not exists job_steps_provider_job
  on public.job_steps (provider, provider_job_id) where provider_job_id is not null;
```

- RLS on and forced, with no browser policy. It is service-role only, like
  `webhook_events`. The user sees progress through the parent job's API, not
  this table.
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated` on the table and on
  every new function (CLAUDE.md).
- Writes go through `SECURITY DEFINER` functions with `search_path = ''`:
  `job_step_submitted`, `job_step_stored`, `job_step_failed`. A step moves
  forward only, and a replayed webhook for a STORED step does nothing.
- The parent `jobs` row keeps its existing states: DEBITED ─► SUBMITTED on
  the first step ─► STORED after the stitch copy, or FAILED ─► refunded.

## 5. Flow and failure paths

1. `POST /api/v1/generations` with `model_id: auto-short-32s`,
   `inputs: {topic}`. `topic` is 3–200 characters, validated by regex at
   the boundary like every input. The existing path does the rate limit, the
   price from the catalog and `ledger_debit`, then submits step 1 instead of
   a provider job.
2. Every webhook (fal, kie, OpenRouter) that finds no `jobs` row for its
   `provider_job_id` looks in `job_steps`. It verifies the signature, dedupes
   through `webhook_events`, copies the output to R2, marks the step STORED
   and submits whatever is now ready.
3. The five-minute cron (`sweep_stuck_jobs` companion) re-polls or re-submits
   steps past their timeout, up to 2 attempts per step.

| What fails | User sees | Credits | Our spend |
|---|---|---|---|
| Invalid topic, rate limit, low balance | Typed error before the debit | none moved | $0 |
| Script or voice step fails twice | Job `failed` | debit + full refund | cents |
| One scene fails twice | Job `failed` | debit + full refund | up to $0.45 |
| Stitch fails twice | Job `failed` | debit + full refund | ~$0.65 |
| Webhook lost | Sweep re-polls; no user impact | — | — |

Refunds are all-or-nothing (ADR-0029 §5).

## 6. UI

- In the Create page model picker, "Auto Short (32s)" appears as a normal
  catalog row. Its only control is a topic box, plus the cost in amber.
- While it runs, show step progress from the parent job: "Writing script ·
  Recording voice · Rendering scenes 2/4 · Stitching". No new page.
- Library shows the final MP4 only. Intermediate clips are not user assets.
  They are swept with the job's retention.
- Behind `localStorage.veyrnox_auto_short` until launch (ADR-0029 §8).

## 7. Moderation and legal

- The topic and the generated script are prompts, and they go through the
  same provider-side filters as today. The script step's system prompt
  refuses real named people, minors and sexual content, and a refused
  script fails step 1 and refunds.
- The output is AI-generated. The EU AI Act Article 50 labelling work in
  the ADR README applies here as it does to every clip.
- MIT attribution for MoneyPrinterTurbo goes in the prompt module header.

## 8. Build plan (one PR each, each with an exit gate)

| # | Slice | Exit gate |
|---|---|---|
| 0 | **Verify the stitch.** Script calling `fal-ai/ffmpeg-api/compose` with 4 of our Veo Lite clips and one TTS file | One MP4 with correct length, voice audible, clips muted; cost read off the fal dashboard |
| 1 | Registry records (ADR-0027) for the LLM, TTS and compose endpoints | Records tested; no catalog row active |
| 2 | Migration: `job_steps`, its functions, grants | Acceptance test: replayed step webhook is a no-op; forward-only transitions |
| 3 | Orchestrator module + webhook lookups + sweep | Local run of the whole pipeline against real providers; a forced failure at each step refunds once |
| 4 | UI behind the flag | Owner generates one short in production with the flag on |
| 5 | Migration: `auto-short-32s` active at the measured price | Reconciliation clean for 24h |

**Launch blocker outside this spec:** a billing provider that accepts AI
generation (LemonSqueezy refused on 2026-09-22). Slices 0–3 can proceed.
Slice 5 waits for billing.

## 9. Owner decisions (2026-09-22)

1. **110 credits** for 32 seconds, re-checked against measured cost in the activating migration.
2. **Voice:** ElevenLabs Turbo 2.5, for its word timings.
3. **Captions:** a WebVTT file in v1. Compose cannot burn text in.
4. **9:16 only** in v1.
