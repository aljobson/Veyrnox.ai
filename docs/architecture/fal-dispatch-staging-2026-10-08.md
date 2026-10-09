# fal dispatch staging evidence — 8 October 2026

This records schema and database smoke acceptance for [ADR 0076](../adr/0076-fal-durable-dispatch.md), following squash merge [PR 654](https://github.com/aljobson/Veyrnox.ai/pull/654), revision `97eef274a741861d0db57fe0b997d07d6f0137fe`. Live Worker/provider acceptance and the twenty-four-hour monitoring gate remain pending.

## Applied staging schema

Verified target: Supabase project `yrqzwqywxfesmbvhzjgj`, named `veyrnox.ai staging`, ACTIVE_HEALTHY, Postgres 17.6. Applied the exact migration files from merged main through the Supabase migration tool:

- `0229_video_agent_sweep_health`: prerequisite task-name registration and recovery snapshot definition.
- `0230_fal_durable_dispatch`: private outbox, admission/attempt/evidence/recovery RPCs, and dispatch recovery counters.

Both names were verified in staging's migration ledger. Other staging migration gaps were left unchanged. The new outbox has ENABLE/FORCE RLS, no table privileges for anon/authenticated, private RPC grants, and service-role execution permission.

## Rolled-back database smoke tests

Two separate transactions created a temporary confirmed Auth user and exercised the existing active `flux-2-pro` catalog entry at its two-credit price. SQL assertions raised on any failure. Both transactions completed successfully and explicitly rolled back. No provider API was called; the accepted handle in the second test was synthetic.

The first test verified atomic job/debit/intent creation, equal replay with the original job, changed-input conflict, a single STARTED claim, REJECTED evidence, recovery through the existing refund RPC, balance restoration, and no second positive ledger entry on repeated recovery.

The second test verified a STARTED attempt older than two minutes becomes UNKNOWN, keeps the original refund deadline, and cannot be claimed again. The recovery snapshot counted the uncertain job. Late accepted evidence and identical evidence replay succeeded; a recovery pass attached the synthetic handle and moved the job to SUBMITTED without another claim. Browser RPC denial and service-role admission permission were checked.

After rollback, the outbox had zero rows and neither test Auth user remained. Balance, Free Credit, and Subscription Credit reconciliation each returned zero differences, both before and after smoke testing.

These checks validate the deployed database definitions, including Postgres 17 compatibility. They do not validate signed user HTTP requests, the deployed cron runner, fal acceptance/redelivery, R2 completion, Library behavior, free-allowance activation, queue latency, provider cost, or twenty-four hours of recovery health.

## Staging Worker readiness

Wrangler's staging secret-name inventory includes FAL_KEY, FAL_WEBHOOK_USER_ID, SUPABASE_SERVICE_ROLE_KEY, and R2 bindings. Only names were inspected; this does not establish credential validity or provider-account isolation. No credentials were copied or changed.

The latest staging deployment observed was version `1db04ce7-3c4f-4ebf-8296-6ef6efa99d5d`, created at 20:15:46 UTC via a secret change, before PR 654 merged. No new staging deployment or feature activation was performed in this step. Both new dispatch flags remain false in the merged configuration.

Staging omits RECOVERY_HEALTH_ENABLED, and Worker vars do not inherit production settings. Explicitly configure and verify staging monitoring before claiming a cron heartbeat acceptance pass. Review the expected health of other scheduled tasks when enabling the shared monitoring switch.

## Production workflow and next gate

The production deployment workflow for `97eef274` completed successfully, including its live-site smoke test. New dispatch flags remain disabled.

The older unapplied migration run `37827188819` was waiting for approval and was cancelled so merged main's current migration plan could proceed. [Migration run 37842129981](https://github.com/aljobson/Veyrnox.ai/actions/runs/37842129981) planned `0229_video_agent_sweep_health` followed by `0230_fal_durable_dispatch`.

After the owner's instruction to continue, approval was submitted through GitHub's protected `production-database` environment as the configured reviewer, `aljobson`. The workflow completed successfully: required-reviewer check, main migration revision check, both applies, and the final migration-ledger check passed. Production DDL was applied by the workflow; the session did not apply it directly through the Supabase tool.

Read-only production verification confirmed both migration names, an empty dispatch table, ENABLE/FORCE RLS, and no browser table privileges. The public migration-ledger check accounted for all 196 applied migrations. Balance, Free Credit, and Subscription Credit reconciliation returned zero differences. The reconciliation watcher additionally reported no Top-up or failed-refund drift; the recovery watcher reported healthy tasks and queues.

All production dispatch flags remain false. A clean verification at this point is not the twenty-four-hour monitoring gate. Complete ADR 0076's live staging matrix, including the deployed runner, signed user HTTP requests, actual provider acceptance/redelivery, private asset completion, and queued latency, before production dispatch activation.
