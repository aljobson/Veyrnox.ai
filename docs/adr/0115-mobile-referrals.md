# ADR-0115 — Mobile: Referrals screen

**Status:** Proposed 2026-10-18
**Related:** [ADR-0071](0071-referrals.md) (the programme and its abuse limits), [ADR-0106](0106-mobile-app.md) (the app), [ADR-0110](0110-mobile-account-and-safety.md), roadmap slice M10b

## Context

The web app shows a person's referral link and how many friends joined. The server routes are `GET /api/v1/referrals` and `POST /api/v1/referrals/attach`, both behind `REFERRALS_ENABLED`. The app has no way to see or share a code.

## Decisions

1. **No server change.** The app uses the two routes as they are.
2. **A Refer a friend screen** (`/referrals`, reached from Account). It shows the person's code, a Share button, the friend count and the programme's terms in the words the web uses: Credits worth 10% of a friend's first Credit Pack, added after 14 days if not refunded or disputed; Credits only, never cash.
3. **Sharing** opens the system share sheet with the web link (`https://veyrnox.ai/?ref=CODE`), which also offers Copy. No clipboard package is added. A friend who opens the link lands on the web app, which already captures the code at sign-up.
4. **Entering a friend's code** is a field on the same screen. It checks the code's shape on the phone (ten characters, no I, L, O, 0 or 1) and sends only the normalised code. The server's refusals are shown in plain words (new accounts only, already attached, own code). It is for an account that is new; the app does not read a code from a link yet.
5. **Off means nothing.** If the server flag is off or the answer is unusable, the screen says referrals are not available rather than showing a broken page.

## Not decided here

- Reading `?ref=` from a link that opens the app (needs app links on a device build, ADR-0106).
- Any in-app reward display beyond the friend count; Credits arrive in the ledger as `referral_reward`.

## Consequences

- No new dependency, so no new native build beyond the one already pending for ADR-0114.
- The store review sees a referral that pays Credits only, in line with ADR-0071.
