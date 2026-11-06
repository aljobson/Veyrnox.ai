# ADR-0328 — Spend watch: warn before a supplier cap refuses customers

Status: implemented for owner review; migration 0444 not applied.
Date: 2026-11-05.

ADR-0323 left `provider_spend_utilization()` with no caller. The database refuses jobs past
the provider and global hour/day caps, and a refusal is a customer-visible outage that
nothing announced in advance.

## Decisions

1. **Verdict-only wrapper (0444).** `spend_watch_status()` calls the service-role-only
   utilization function and returns `level` (`ok` / `warn` at 80% / `critical` at 100% or
   admission closed), `scope` (`global`, `provider`, `user`) and `admission_open`. A closed global admission switch is critical and named `global`. A provider switch closed while that provider took jobs in the last 24 hours is a `warn` naming `provider`; providers closed from the start (Higgsfield, 0437) are ignored, since nothing closes one automatically and a standing closure is not news. Utilization carries only the global flag, so provider closures are read from the provider policy rows. No
   percentage, user or provider name. Thresholds are fixed in SQL so the answer cannot be
   probed into a number. It is callable with the public key like `reconcile_status()`
   (PR #61), so Actions holds no service-role key.
2. **Workflow.** `spend-watch.yml` runs every 15 minutes on main (the hour caps are rolling one-hour windows, so a slower poll could miss a spike that rises and expires between checks), reads the verdict with
   `scripts/check-spend-watch.mjs` and opens one `spend-watch` issue per episode. Exit 2
   (unreadable) fails the run and files nothing: an outage is not a pass. Pause with the
   repository variable `SPEND_WATCH_ENABLED=false`.
3. **No auto action.** The issue points at the three levers (raise a cap, per-account AI
   switch of ADR-0327, generation switch of ADR-0319). Nothing is switched off automatically.

## Not done

- Reservations are worst-case estimates, so this says how close to refusing, not what a
  supplier billed. The provider-side budget cap and the real invoice stay a dashboard matter.
- Chat search, ElevenLabs and the video-agent runner reserve no row (ADR-0323), so they are
  invisible here.

## Rollback

Delete the workflow or set `SPEND_WATCH_ENABLED=false`; `DROP FUNCTION public.spend_watch_status()`.
