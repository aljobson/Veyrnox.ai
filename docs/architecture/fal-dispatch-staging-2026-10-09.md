# fal dispatch live staging evidence — 9 October 2026

This follows the [database acceptance record](fal-dispatch-staging-2026-10-08.md) and [ADR 0076](../adr/0076-fal-durable-dispatch.md). Production admission remains disabled. This is a bounded runner smoke test, not completion of the full staging matrix.

## Deployment and configuration

Built checkout `2297e3fdbdb37da89111087424769887c7b2fb29` with the two staging configuration changes in this PR. Ran `npm ci`, then `APP_ENV=staging PUBLIC_HOST=https://veyrnox-ai-staging.al-jobson.workers.dev npm run build:worker`. Build, Wrangler dry-run, and sixteen focused dispatch/recovery-health tests passed.

Deployed Worker `veyrnox-ai-staging`, version `923927fa-e94f-4b50-9979-c068882befbf`, created at 04:59:41 UTC. Read back deployed bindings and compared every plain-text variable against the preceding version `09c91307-3369-4f41-bd39-67e459f2d09f`. Exactly two differences:

- `FAL_DISPATCH_SCHEMA_ENABLED`: false → true, allowing the cron to drain admitted work.
- `RECOVERY_HEALTH_ENABLED`: absent → true, enabling task heartbeat reporting.

`FAL_DURABLE_DISPATCH_ENABLED` and `FAL_SUBMIT_OUTCOME_ENABLED` remain false. No production settings changed. Existing live staging overrides for `AGENT_VIDEO_ENABLED`, `MONTAGE_LIVENESS_ENABLED`, and `MONTAGE_RUNNER_BASE` were preserved through a temporary deployment configuration and `--keep-vars`. No secrets were read, copied, or replaced. The temporary file is not part of this PR; the repository's separate montage settings still differ from those live overrides.

The staging `/app` returned HTTP 200. Generation requests with missing authentication, and with a malformed bearer token plus forged identity header, returned HTTP 401. These checks do not establish authenticated generation behavior.

## Bounded live fixture

Target database: `yrqzwqywxfesmbvhzjgj` (staging). A dedicated confirmed fixture Auth user was provisioned through the existing Auth triggers, with no password or signed-in browser session. Admission used the private `admit_fal_dispatch` RPC; the public durable route stayed disabled.

| Field | Value |
| --- | --- |
| Public fixture user | `2bb45f45-414e-4945-bc81-f6e0d8772e1f` |
| Job | `2c1f9b8c-57bb-49b5-9722-8e1b566284ad` |
| Idempotency key | `fal-stage-20261009-smoke-01` |
| Model / endpoint | `flux-2-pro` / `fal-ai/flux-2-pro` |
| Admission time | 05:02:56 UTC |
| Price | Two staging credits; signup balance 10 → 8 |

The input and provider payload contain only the same prompt: “A plain ceramic teapot on a wooden table, soft studio lighting, no text.” The [official model schema](https://fal.ai/models/fal-ai/flux-2-pro/api) was checked before using this input. The catalog's provider cost estimate is $0.03 per generation; this is not a measured invoice charge or proof of separate provider-account billing.

One admission created one READY intent and one DEBITED job. Equal replay returned the original job with `idempotent:true` and balance 8; changed input returned `IDEMPOTENCY_CONFLICT`. No manual dispatch claim, provider retry, or state reset was used. The fixture and its financial evidence are retained.

## Observed completion

The deployed cron completed the normal path:

| Event | UTC time / evidence |
| --- | --- |
| STARTED claim | 05:06:17.732509; attempt `c28f8e34-6e9a-496c-b97e-819186a0633c` |
| ACCEPTED evidence | 05:06:18.012167; provider request `01a11f0e-10df-7be1-9fb7-026ccb1b9e18` |
| Handle projected | 05:06:18.056407 |
| Signed webhook processed | 05:06:29.103 |
| STORED / asset registered | 05:06:29.125113; asset `b5fc2bd1-564a-45e8-9b21-0405c6bde0d3` |

One JPEG asset was registered with 167,934 bytes and a SHA-256 value. No signed asset URL or private storage credentials were retrieved. Admission-to-claim latency was 201.67 seconds; admission-to-STORED latency was 213.06 seconds. This is one cron-aligned observation, not a queue-load percentile or an agreed latency target.

The retained job has one ledger entry: `debit:generation`, delta -2, Free delta -2, Subscription delta 0; no refund. Balance remains 8. Balance, Free Credit, and Subscription Credit reconciliation each returned zero differences after completion.

Dispatch heartbeat at 05:06:18.141546 had `last_ok:true`. Refreshed recovery counters showed zero unknown and zero overdue dispatch jobs; all queue counters were zero. Shared staging health still reports `top_up_backfill` unhealthy. The deployed binding-name inventory lacks `TOP_UP_BACKFILL_TOKEN`; its configured HTTPS `PUBLIC_HOST` is present. That separate configuration issue needs resolution before the twenty-four-hour monitoring gate can pass.

## Outstanding acceptance

The browser-skill daemon was healthy but had no connected browser. Authenticated gateway responses, Studio/Library behavior, full callback redelivery and failure injection, free-allowance activation, queue-load latency, and the twenty-four-hour clean monitoring gate remain pending. A single normal completion cannot establish these guarantees. Production activation requires the remaining ADR 0076 checks.
