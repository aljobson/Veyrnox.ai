# ADR-0339 — First-run personal answers (role, goal, destination)

**Status:** Proposed 2026-11-13. Extends ADR-0336. Migration 0499. Same switch: `FIRST_GOAL_SYNC_ENABLED`.

## Context

A first-run flow in comparable apps (Suno, CapCut, Photoroom) asks one short question per screen and uses the answers at once. Veyrnox asked only one question, once, on Create. Nothing about the first screens changed for a creator, a business or a beginner, and the answer did not follow the person from phone to web.

## Decision

Up to three questions, one per screen, each skippable, right after the three welcome cards on mobile and on first arrival at `/app` on the web (which has no welcome screen), after the age confirmation and sign-in, never before them:

1. **Which describes you best?** `creator`, `business`, `pro`, `hobbyist`, `beginner`.
2. **What do you want to make first?** The existing goal list (ADR-0336).
3. **Where will it go?** `tiktok`, `reels`, `youtube`, `private` ("just for me").

Each answer is one fixed word (or `skipped`): no free text, never in a URL, never logged. The flow is shown only to a person with no goal and no role on record, so existing accounts are not asked again.

**What the answers change.** Nothing about credits, prices, models offered or access.
- Role orders the four home start options and decides whether the example prompts are the work set (creator, business, pro) or the everyday set (hobbyist, beginner, none). The first option shows "Suggested for you" once any real answer exists.
- Goal opens Create on that kind (or Edit, or Publish) with one example prompt, as in ADR-0336, and moves a matching start option to the front.
- Destination sets Create's default aspect ratio (TikTok and Reels 9:16, YouTube 16:9; "just for me" changes nothing). The person can change it as before.

**Storage.** `public.first_goals` gains nullable `role` and `destination` (CHECK-listed words) and `goal` becomes nullable (null = never chose). `get_first_answers` / `set_first_answers` are SECURITY DEFINER with an empty search path, executable by `service_role` alone. A real word is never lowered to `skipped`; replaying a body changes nothing. The 0494 functions are unchanged. Deletion and the privacy export already cover the table; the export wrapper is replaced to add the two keys.

**API.** `GET /api/v1/first-goal` also returns `role` and `destination`. `PUT` accepts any non-empty subset of `goal`, `role`, `destination`; `{ goal }` alone still calls `set_first_goal`. Unknown keys and unlisted words are refused with `400 invalid_goal` naming the field.

**Device copy.** Until the account copy is switched on, each device keeps its own answers in one slot (`veyrnox.firstProfile.v1`, role and destination only; the goal keeps its slot). Web and mobile do not share them until `FIRST_GOAL_SYNC_ENABLED` is on.

## Not decided here

- The Vibe Check store (ADR-0251) is left as it is: it needs all six answers at once and sits behind its own production secret.
- No backfill, as in ADR-0336.
- Migration 0499 is applied only by the `apply-migrations` workflow after the owner approves the run. Do not turn the flag on before it has landed.
- Vey's greeting wording is not personalised in this slice.

## Amendment — resumable account progress (2026-11-21)

Migration 0578 adds a small versioned progress contract beside the existing fixed-word answers. Version 1 has one
canonical order on web and mobile: `goal`, `destination`, `role`, then the sample-result recap. A skipped goal takes the
short path after role; every other answered goal reaches recap. `completed` is latched only after that journey finishes.
Skipping skips the current question only. Dismissing the web dialog does not manufacture skipped answers.

Existing rows containing all three answers are complete. A row containing role or destination but missing another answer
resumes at the first missing canonical step. A goal-only row is grandfathered as version 0 complete: an ADR-0336 account
cannot safely be distinguished from a phone closed after the newer goal screen, and re-asking every such account would
collect unnecessary profile answers. No completion timestamp, device identifier, free text or answer telemetry is added.

`GET /api/v1/first-goal` appends `version`, `current_step` and `completed`. Old PUT bodies retain their exact contract;
version-1 clients send the displayed step with its one answer, and send a separate recap completion. The database locks
the account row, applies the existing answer ranks and derives the next step, so replay, Back edits and concurrent devices
cannot move progress backwards. One owner-stamped device envelope is only an offline cache; mismatched accounts cannot
read it. The account copy remains authoritative and is erased/exported with `public.first_goals` as before.

Roll out in dependency order: apply 0578, deploy the additive route, then release web and mobile callers. The existing
`FIRST_GOAL_SYNC_ENABLED` flag remains the emergency stop. A client/route backout is safe while the additive columns and
RPC remain in place; do not reverse the data migration after version-1 writes exist. Old clients continue through the
unchanged RPC signatures and response shapes throughout the rollout.

Completion is never inferred from an unacknowledged client write. Web and mobile first persist an owner-stamped pending
envelope, replay its fixed-word answers in canonical `goal`, `destination`, `role`, `recap` order with bounded requests,
and clear pending only when the account read is authoritative. A conflict or transport failure is reconciled by GET and
otherwise remains pending for the next launch, online event or foreground. The person can leave immediately while that
bounded sync runs; no account switch may finish another owner's pending work.

Escape on the web dismisses the flow for that owner in the current tab session only. It writes no skipped answers and a
remount does not reopen it; another account in the same tab remains independent. A failed account read falls back to the
ordinary signed-in shell with neutral ordering while it remains explicitly unresolved; web and mobile stop timer-driven
launch retries after three attempts, and an online/foreground signal retries.
Until an owner-matching account or device envelope exists, the flow remains unresolved and never borrows another user's
global device answers.

The pre-existing Home start action deliberately keeps sending the legacy `{ goal }` body. Under the migration's legacy
classification that goal-only row is version 0 complete, so using Home does not later force the new optional destination
or role questions. This is the only intentional shortcut; version-1 Escape and partial progress never fabricate skips.
