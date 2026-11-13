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
