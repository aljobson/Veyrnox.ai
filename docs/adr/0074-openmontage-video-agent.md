# ADR-0074 — OpenMontage as an isolated video-agent service

- **Status**: **Proposed 2026-10-07** (owner: "go with recommendation" on the isolated-service option). Nothing is built.
  Three open questions are listed at the end; none of them blocks writing the spec, all block launch.
- **Related**: ADR-0029 (Auto Short composite jobs), ADR-0072 (Agents scope), ADR-0070 (Deep research cost), ADR-0027
  (capability registry), CLAUDE.md "Money & billing", "Provider webhooks", "Object storage", "Bundler traps"

## Context

[OpenMontage](https://github.com/calesthio/OpenMontage) (AGPL-3.0, Python, pushed 2026-10-03) describes itself as an
agentic video production system: 12 pipelines, 100+ tools, 700+ skill files. Read from its README and `AGENT_GUIDE.md`
on 2026-10-07:

- **The runtime is a coding agent, not a library.** "Rule Zero": every request goes through a pipeline; the agent reads
  `pipeline_defs/<pipeline>.yaml`, then a stage-director skill per stage, then provider skills before calling a tool.
  It runs preflight, shows a capability menu, estimates cost, and asks the user to approve before generation.
- **It needs FFmpeg, Remotion (Node), optionally Blender**, plus the user's own provider keys (fal, Veo, ElevenLabs...).
- **AGPL-3.0.** Offering a *modified* version to users over a network obliges us to offer them that source. An unmodified
  copy running as its own process, which our code reaches only over HTTP, does not pull our repo under the licence.

None of this runs on a Cloudflare Worker, and a priced, credit-metered product cannot let an unattended LLM loop spend
provider money freely (ADR-0070 found the same shape of problem in the OpenRouter web plugin).

## Decision (proposed)

### 1. Isolated service, never vendored

- OpenMontage runs unmodified in its own container, in its own repo (`veyrnox-montage-runner`, pinned to a release tag or
  commit), host chosen in the first open question. **No OpenMontage code is imported into this repo.** Anything we would
  patch is first tried as configuration or as an extra skill file kept outside its tree; a patch to its source needs an ADR
  because it triggers the AGPL source offer.
- The Worker never runs ffmpeg, Python or Remotion. It creates a job, signs a request to the runner and waits.

### 2. One priced job, not an open-ended agent session

The runner is driven by **our** controller, not a free chat. A user gets a short brief form (topic or reference-video URL,
length, aspect, style) instead of a conversation. The controller:

1. runs the pipeline's planning stages and returns a **plan with a cost estimate** to the app;
2. waits for the user's explicit **Approve** (the price is already shown in Credits);
3. only then lets generation stages run, with every provider call routed through a **Veyrnox-held gateway key** and a hard
   per-run spend ceiling. A run that would exceed the ceiling stops and refunds the remainder.

This mirrors ADR-0072's rule for Agents: media spend only through a priced job, never an unconfirmed tool call.

### 3. Money

- One catalog row (`model_catalog.credits_*`), normative price; the app computes nothing. A new capability record in
  `lib/modelCapabilities.js` lists the allowed inputs (ADR-0027); an unknown model id is 501 before any debit.
- Debit once at Approve through `ledger_debit` with the job's idempotency key; refund through `ledger_refund` on runner
  failure, timeout, cancel or ceiling hit. All-or-nothing in v1 (as ADR-0029), no partial delivery.
- The credit price must cover the **per-run ceiling** at the ≥ $0.075/credit floor (ADR-0018), not the average run. Until
  the ceiling is measured on real runs there is no price, and no launch.

### 4. Trust boundaries

- Runner to Worker: a signed callback (HMAC-SHA256 over timestamp + raw body, ±300 s, `webhook_events(source, external_id)`
  dedupe), same shape as Stripe. The callback names the job id only; `user_id` always comes from our `jobs` row.
- Worker to runner: the URL is a constant (`MONTAGE_RUNNER_BASE`), never derived from input. Runner endpoints accept only
  our signature. The runner has no Supabase key and no R2 write key; it uploads to a **presigned PUT** that the Worker
  minted for a random-UUID key scoped to the job (TTL ≤ 15 min, so the runner asks for a fresh URL at finish).
- A reference-video URL is user input fetched by a server we run. It is fetched **inside the runner only**, through an
  egress allowlist (public hosts, no RFC1918/link-local/metadata), with size and duration caps, never by the Worker.
- Generated skill/agent text is untrusted: the runner runs in a container with no network except the provider gateway and
  the allowlisted fetcher, a read-only repo mount, CPU/RAM/time limits and a scratch volume wiped per job.

### 5. Rollout

- `AGENT_VIDEO_ENABLED = "false"` in `wrangler.jsonc`; staging first. Dark until the migration has landed and
  `reconcile_balances()` has been clean for 24 h.
- Output passes the same moderation and C2PA steps as any generation (ADR-0005 Article 50 wording), and the provider-ToS
  question for resale (below) is closed first.
- Slice order: (a) ADR sign-off and the three answers; (b) runner repo and one pipeline end to end on staging with a fake
  gateway; (c) `jobs` kind + callback + refund path with idempotency tests; (d) brief form + plan/approve UI behind the
  flag; (e) measured ceilings, then the price.

## Why not the alternatives

- **Vendor or fork it into this repo**: breaks the Worker build (Python, ffmpeg), and a modified fork shown to users
  attaches the AGPL source offer to our work.
- **Expose it as a free chat agent**: unbounded provider spend and an LLM loop reachable by any signed-in user; fails the
  "Money & billing" rule that every debit has a price known before it runs.
- **Borrow only the ideas** (reference-video analysis, pipeline templates) into ADR-0072's Agents: cheaper, no AGPL, and
  still available later; it does not give users the finished-video product.

## Consequences

- A second deployable with its own patching, secrets and monitoring. Its health check joins `site-health`.
- Quality and cost depend on upstream's prompts and skills, which change; the pin is bumped deliberately, with a staging
  run, never automatically.
- Throughput is bounded by runner concurrency; a queue depth limit returns a typed `{error: "montage_busy"}`.

## Decisions on the open questions

1. **Runner host: a managed container host with per-run machines (Fly.io Machines is the working choice).** One Docker image
   (Python, ffmpeg, Node/Remotion), a machine started per job and stopped after, so idle cost is near zero and a stuck run
   cannot hold the box. Cloudflare Containers is rejected for v1 (beta, long CPU-heavy renders); a standing VM is rejected
   (idle cost, shared scratch between jobs). Accepted 2026-10-07 (owner: "go with recommendation"). Region: EU, to match
   ADR-0005.

## Still open (owner only, blocks launch)

Public-terms check, 2026-10-07 (search only, not legal advice; the full current texts were not read):

- **fal**: its Terms of Service disclaim any ownership of Output Content and say outputs may not be unique across users. A
  separate general page (`fal.ai/terms`) bars "revenue-generating" use of the site and Content; unclear whether it covers
  API output. Each hosted model can also carry its own licence.
- **Google (Gemini API / Veo)**: the Gemini API terms say Google claims no ownership of generated content and put
  responsibility for onward use on us. The separate preview-products terms bar commercial use and disclosing output to third
  parties for any product classed as preview. Whether the Veo model we would call is GA or preview is not settled.
- **Working rule until closed**: v1 may call only models already live in `model_catalog` under the terms we accepted, each
  recorded as GA with a commercial-use licence; no preview-class model.


2. **Provider resale terms.** Do fal and Veo allow us to resell generated output inside a credit product? fal and Veo are
   already in the catalog, so check the existing terms first; any new provider goes through the verified-endpoint rule.
3. **AGPL position.** Counsel to confirm that unmodified, separate-process use over HTTP does not extend the licence to this
   repo. If a patch is ever needed, we publish that patch.
