# Owner website video proofs

Keep `ownerProof` absent or false until the owner explicitly authorizes activation. This implementation does not enable it, apply migrations, deploy, or run billed supplier requests.

## Prerequisites

**Hard merge precondition for 0607:** PR **2685**, migration **0604_route_failure_accounting.sql**, must be merged and applied first. Main's **0600_music_albums.sql** is a separate migration. Immediately before merging 0607, recheck main and all open PRs for migration numbering and order. Do not merge or apply 0607 ahead of 0604.

1. Independently review the owner-proof changes. Confirm PR 2685 and its migration `0604_route_failure_accounting.sql` are merged **and applied**. Verify both prerequisite markers: column `public.model_routes.breaker_first_opened_at` and public function `job_route_close_refused`.
2. Review and apply this build’s telemetry-only `0607_owner_proof_telemetry.sql` after 0604. Its prerequisite DO block checks both markers and refuses replay if either is absent; refusal on this branch before PR 2685 is available is intended. It does not open any offer. Confirm Seedance migration 0598 is applied: both catalog rows remain inactive/gated, with standby Crun routes and catalog credits 76/78. Confirm the Veo changes are merged and deployed before any Veo proof.
3. Confirm Crun is enabled/configured, provider spend admission is open, and there is sufficient credit balance on the existing administrator account. Veo still needs active matching Crun routes and no stored endpoint breaker. Do not clear a breaker merely to make a proof pass; follow its incident procedure.
4. With owner authorization, add `"ownerProof":true` to the existing JSON `APP_RUNTIME_FLAGS` binding, preserving its other keys. Put no account identifier in that binding. No public Seedance or Veo image flag needs enabling; no catalog row or parity marker needs changing.

## Website steps

1. Open `https://veyrnox.ai`, sign into the existing admin account, and complete its enrolled authenticator challenge. A password-only (`aal1`) session cannot use the private offers. Open Studio, then Library (`/app/library`). Reload or refocus after activating the switch.
2. Upload an owned MP4 source of about five seconds through the site's normal upload flow, or choose an owned stored video in Library. Both picture and conservative container duration must satisfy the contract: edit 4–10 seconds, extend 4–6 seconds. Keep audio duration within those limits too.
3. On that video's actions choose **Restyle**, enter a short transformation prompt, select **Check price**, then **Confirm and generate** at the displayed credits. At exactly five seconds the placeholder is 76 credits; just over five seconds costs 152 because edit rounds up in five-second units. Record the returned job ID and wait for its Library result.
4. Repeat with **Extend**, describe the continuation, select **Check price**, then **Confirm and generate** for 78 credits. It buys a five-second extension. Record the job ID. Neither submitted job is cancellable; do not retry with a new key to investigate a pending job.
5. After the Veo prerequisite is satisfied, open Create and select **Veo 3.1 Lite**. Attach one owned image using the normal image upload or Library picker, enter a short motion prompt, and generate at the displayed catalog price. Repeat for **Veo 3.1 Fast**, then **Veo 3.1** if authorized. The image path accepts one image, 720p, and the existing supported duration choices; its supplier output is eight seconds. Record each job ID.
6. Wait for each job to settle. Use its result/Library view to play the stored output and inspect representative frames, motion, duration and audio. Do not treat a returned supplier task ID as a completed proof.

Only first-party aal2 sessions on Create and Library Seedance surfaces use silent discovery; OAuth apps and MCP cannot enable these proofs. Returning from a file picker, refocusing, and transient discovery failures retain the last private models. Definite 401/403/404 refusals clear them; if a private image slot that was exposed with an attached, restored or carried image is withdrawn, Create blocks submission and offers Remove image. New generation remains available. Ordinary public-model switches and Chat retain their existing attachment handling.

The phone uses the same authenticated discovery route and offers Remove image when private withdrawal leaves an undeclared source slot. Seedance actions appear on Library video items; Veo's image slot appears on its Create form. Public catalog caches remain public on both clients.

## Read afterwards

For every recorded ID, inspect the job and normal ledger/audit views (read only):

- `jobs.model_id`, `provider`, `provider_job_id`, `credits`, state, timestamps and `inputs.owner_proof === true`.
- Seedance `inputs.seedance25_billing` (measured source seconds, units, credits), and source reference identities. Stored inputs must not retain temporary signed URLs.
- The debit amount and idempotency key; on failure verify the normal refund and resulting balance. Proofs must have a real debit, not a free-allowance job.
- Provider spend reservation/outcome and any refusal/breaker records. Seedance standby dispatch can have no `job_attempts` row; the job/provider task remains the audit identity.
- Successful output's stored asset/R2 key, MIME, size, hash and measured duration. Confirm the result is served from Veyrnox storage rather than only a temporary supplier host. Inspect provenance and moderation outcomes through the existing job records.
- Capture a brief visual review and representative frames without publishing signed source URLs. Exclude jobs whose `inputs.owner_proof` is true from product-metric queries.

Planning estimates from the frozen work order: Seedance edit about $1.35, extend $1.39, Veo Lite $0.07, Fast $0.15, Veo 3.1 $1.09; approximately $2.96 excluding Veo 3.1 or $4.05 including it. These are estimates, not newly verified supplier prices or approved customer prices.

Turn `ownerProof` off after the proofs. Refocus/reload both clients and confirm private offers/image slots disappear. Sign out and sign in as a non-admin to confirm absence, including when the owner's earlier discovery response is delayed. Verify `/api/catalog` remains unchanged. Existing jobs continue through normal completion/refund/storage paths after the switch is off. A proof result does not authorize public activation, pricing changes, or a parity marker update.
