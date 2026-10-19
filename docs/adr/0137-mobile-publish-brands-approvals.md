# ADR-0137 — Mobile: Publish brands and approvals (M11 slice 3a)

**Status:** Proposed 2026-10-18
**Related:** [ADR-0061](0061-veyrnox-publish-social-scheduling.md) (Publish); [ADR-0121](0121-mobile-publish-overview.md) and [ADR-0122](0122-mobile-publish-composer.md) (the screens this builds on); `docs/mobile/ROADMAP-2026-10-17.md` (M11)

## Decision

Two read-only screens, no new server route, no flag and no new dependency.

1. **Brand** (`/publish/brands`). A person can belong to several Publish brands (their own, a client's) with a role in each. The list comes from `GET /api/v1/social/brands`. The choice is held in memory (`brandStore`) and added as `x-publish-brand-id` to calls under `/api/v1/social/` only (never to the brand list itself). Accounts, Posts, a post, Analytics, the composer and Approvals all use the brand-aware client (`usePublishApi`), so they reload when the choice changes. With nothing chosen the header is left off and the server uses the person's own brand, as before.
2. **Approvals** (`/publish/approvals`). `GET /api/v1/social/approvals` lists the posts the person sent to outside reviewers and where each stands (status, scheduled time, each reviewer's decision and comment). Reviewers decide on the web through a signed link; **the app does not decide, send or resend anything**.

## Choices that matter

- **The signed review links are dropped.** The server adds a signed bearer link to each reviewer in the approvals list. `parseApprovals` never reads it, and a test checks that a link in the response appears nowhere in the parsed result. The app does not show, store or share it.
- **The selection is not saved.** Every launch starts on the person's own brand. A choice the brand list does not contain (another account, a removed membership) is cleared when the list loads. The server is the authority on access: a brand that is not theirs is a 404, a role that cannot see approvals is a 403 (`brand_role_forbidden`), no plan is a 402.
- **Plain errors** for each of those, and for approvals not open yet, rate limits, offline and not configured. Teams not open (404 on the brand list) means "only your own brand", not an error.
- Strings are new keys (`brands.*`, `approvals.*`), English only, listed in `docs/mobile/I18N-NEW-KEYS.md`.

## Proved, and not

Proved on the simulator against the mock server: the Approvals list (three requests, five reviewers, no link shown); the Brand list with a check on the choice; choosing a view-only brand reloads Approvals to the role message; choosing a client brand makes Accounts show that brand's account. 25 new unit tests (parsing, the header rule, the store, error mapping, and the dropped link).

Not proved: any real server. In particular the real list's field names beyond those read from `0304_social_approvals.sql`, the 402 and 403 bodies, and a real second brand. Persisting the choice, and deciding or sending an approval from the phone, are deliberately not built.

## Follow-ups

- Calendar and best-time (slice 2), drafts (slice 3), connect a network (slice 4, with the server's ADR-0136 return target).
- If the owner wants the brand to survive a relaunch, store the id per account in the app cache (it is wiped on sign-out).
