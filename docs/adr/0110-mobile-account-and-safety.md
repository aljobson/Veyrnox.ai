# ADR-0110 — Mobile: Account screen, reporting and the age gate

**Status:** Proposed 2026-10-17
**Related:** [ADR-0106](0106-mobile-app.md) (the app), [ADR-0083](0083-admin-operations-surface.md) (reports, admin review), [ADR-0108](0108-mobile-store-billing.md) (restore purchases), roadmap slice M5

## Context

Both stores review an app that lets people make and share AI content for a visible way to report it, a contact route, and an account-deletion path inside the app. Apple also asks for a way to block abusive users where other people's content appears. The app so far only shows a person's own creations, chats and balance.

## Decisions

1. **Account screen** (`/account`, reached from Home). Sections: Purchases (Restore purchases, shown only when store billing is on, enabled once the account is bound), Safety (report), About and contact (terms, privacy, acceptable use, refunds, support email), Your data (delete account) and Sign out.
2. **Reporting** uses the existing `POST /api/v1/reports` unchanged. The app sends `subject_kind` `job` with the creation's id from the creation screen, or `other` with at least ten characters of detail from Account. The categories and limits mirror the route's, and the app checks them first. A repeat report answers with the first. The reporter is told nothing about the outcome, as the route's procedure says.
3. **Block is not built.** There is no block route, and nothing in the app shows another person's content yet, so a block control would have nothing to act on. It is owed with the first slice that does (Cinema, M9), with its own server route. This ADR does not claim Apple 1.2 block coverage before then.
4. **Account deletion is shown but off** until the server route exists (roadmap S1). The button is visible and disabled, and the screen says to email the privacy address from the account address in the meantime. `ACCOUNT_DELETION_ENABLED` is the single switch. Shipping to the stores waits on this being on.
5. **Age gate.** The privacy policy says the service is not for anyone under 18, so the sign-in screen asks for a tick on "I am 18 or older and agree to the Terms and Privacy Policy" before any sign-in button works. It is held in memory only and asked again each sign-in; the server stores nothing about it. The store age rating must match 18+.
6. **Restore purchases** restores store subscriptions (the Publish Plan). Credit packs are consumables and are never restored; their credits arrive through the server on purchase (ADR-0108). The screen says so.

## Not decided here

- Block and mute (with Cinema), push consent (S2), the deletion route and its retention rules (S1).

## Consequences

- No server change in this slice.
- A reviewer can find report, contact, restore and deletion in one screen. Deletion and block are visibly incomplete until their server routes exist, which is the honest state.
