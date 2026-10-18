# M7 — Store submission checklist (iOS first, then Android)

Written 2026-10-18 from the state of `main` and the staging checks of M4 to M6. It lists what must exist before a TestFlight build, who does each part, and what is **not yet proved**. Roadmap row: `ROADMAP-2026-10-17.md` M7. Decisions behind it: ADR-0106 (app), ADR-0108 and 0109 (billing), ADR-0110 (account, reporting, age gate), ADR-0111 (deletion).

Legend: **Owner** = only the owner can do it (accounts, keys, store consoles). **Mobile** = the mobile session can do it. **Server** = a server session or the owner's flag change.

## 1. What is already true

- Release plumbing: EAS profiles `development`, `preview`, `production` in `apps/mobile/eas.json`; mobile CI typechecks, tests and bundles on every change under `apps/mobile/**`; Sentry crash reporting with account data scrubbed (M4).
- Account screen with restore purchases, report, legal and support links, delete, sign out; 18+ tick before sign-in (M5, ADR-0110).
- Test Store purchase of a credit pack on staging was credited by the webhook (M6).
- Bundle id and package name `ai.veyrnox.app`; `ITSAppUsesNonExemptEncryption` is `false` (HTTPS only).

## 2. What is not proved yet (do not claim these in the store forms)

- A **refund** of a store purchase: the Test Store gave no refund, so the clawback is covered only by database tests. Needs a real sandbox purchase (step 6).
- Any **real store purchase** (Apple sandbox, Google licence tester).
- **Account deletion end to end:** the app code is in PR 1218 and the server in #1211, but no environment has the server flag on, so the ready, blocked and erase paths have never run.
- **Push** and **app links:** server PRs 1219 and 1216 are open; nothing app-side exists. Both need a signed device build.
- **Apple and Google sign-in on a signed build.** Google sign-in works on staging through the `/auth/mobile` bridge (ADR-0106 amendment 1); Apple needs the Services ID and bundle id set in Supabase.
- **Report flow against production** (`POST /api/v1/reports`).

## 3. Owner steps (nothing below can be done from the repo)

| # | Step | Needed for |
|---|---|---|
| O1 | Apple Developer Program team; App Store Connect app record for `ai.veyrnox.app` | everything iOS |
| O2 | App Store Connect API key, uploaded to EAS and to RevenueCat (Veyrnox.ai iOS app shows no key yet) | `eas submit`, receipt checks |
| O3 | Expo account, then `npx eas-cli init` in `apps/mobile` (writes the project id into `app.json`; the mobile session commits it) | any EAS build |
| O4 | In-app purchase products in App Store Connect: `ai.veyrnox.credits.100`, `.270`, `.1200`, `.3000` (consumable) and `ai.veyrnox.publish.weekly`, `.monthly`, `.annual` (subscription), prices per ADR-0108/0109 | purchases |
| O5 | RevenueCat: attach those products to the `credits` and `publish` offerings for the iOS app; copy the public iOS SDK key into EAS as `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | purchases |
| O6 | Sentry project: DSN as `EXPO_PUBLIC_SENTRY_DSN`, token as `SENTRY_AUTH_TOKEN` (EAS secrets) | crash reports |
| O7 | Supabase (production **and** staging): Apple provider has `ai.veyrnox.app` as an authorized client id next to the Services ID. The redirect list is no longer needed for Google or Apple (amendment 1) | Apple sign-in |
| O8 | Decide the Apple sign-in path on the simulator/device: native sheet needs an Apple ID on the device | testing |
| O9 | Confirm the encryption declaration (HTTPS only, exempt) and the age rating **18+** to match the privacy policy | App Store Connect forms |
| O10 | A review account: a production email account with some credits, credentials in App Review notes (Apple cannot pass Turnstile on a fresh sign-up) | App Review |
| O11 | Google (second): Play Console app, service account key into RevenueCat and EAS submit, licence testers | Android |

## 4. Server and flag steps

| # | Step | Owner of the step |
|---|---|---|
| S-1 | `STORE_BILLING_ENABLED` on in production needs a text-binding slot: production vars are at the 77 cap (`tests/workerBindingBudget.test.mjs`). Free a slot or move a var first | owner + server |
| S-2 | `ACCOUNT_DELETION_ENABLED` on in the environment the build targets, after migration 0347 is applied there; not in `wrangler.jsonc` (binding cap, CLAUDE.md) | owner |
| S-3 | `REVENUECAT_WEBHOOK_SECRET` set on production; webhook added in RevenueCat for the production project; `reconcile_top_ups()` returns zero rows before the flag goes on (ADR-0108) | owner |
| S-4 | Migrations 0344 and 0346 are already on production and staging; 0347 (deletion) and 0348 (push) must be applied by the `apply-migrations` workflow with the owner's approval | owner |
| S-5 | After PRs 1216 and 1219 merge: Apple Team ID and Android fingerprints in `lib/mobileAppLinks.js`; `PUSH_NOTIFICATIONS_ENABLED` per environment | owner |

## 5. What the mobile session prepares

| # | Item | Status |
|---|---|---|
| M-1 | `EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED=true` in the `preview` profile once S-2 is on in staging; in `production` only when it is on there | after PR 1218 |
| M-2 | `app.json`: `ios.associatedDomains`, Android intent filters and route mapping from `/app/*` web paths to app screens | after PR 1216 |
| M-3 | `expo-notifications`, device registration on launch and sign-in, delete before sign-out, route a push to the job screen, Android channel `jobs` | after PR 1219 |
| M-4 | iOS push entitlement and FCM credentials in EAS | owner supplies credentials |
| M-5 | App Review notes text, privacy label answers and the screenshot list (section 6) | this document |
| M-6 | `eas.json` `submit.production` filled in (Apple id and app id) | after O1 and O2 |
| M-7 | Fix: Home does not refresh the balance after Buy credits (stale number on return) | small PR, any time |

## 6. Store forms: what to say

**Data collected (privacy label / Play Data safety), all linked to the account unless noted**

- Contact info: email address (sign-in).
- Identifiers: account user id; the store customer id (a random id, not the account id).
- Purchases: purchase history (RevenueCat).
- User content: prompts, chats and generated images, video and audio (kept 90 days for generated media; chats until deleted, per the privacy policy).
- Diagnostics: crash reports (Sentry), with user, request bodies, headers and URL queries removed (`apps/mobile/src/lib/scrub.ts`). Not used for tracking.
- No advertising id, no tracking, no location, no contacts. Push token once M-3 ships.

**Policy points a reviewer checks, and the honest answer today**

| Rule | Where it stands |
|---|---|
| 1.2 user content: filter, report, block, contact | Report: yes (Account and each creation). Contact: yes. Block: **not built**; nothing shows other people's content yet (ADR-0110 decision 3). Say so in review notes rather than claim it |
| Google Play AI-generated content | In-app report of a creation is present. Describe the AUP and the safety filters in the notes |
| 3.1.1 in-app purchase | Packs and the Publish Plan use the store. The app has no link to web checkout and no steering; keep it that way |
| 3.1.2 subscriptions | The paywall must show price, period, auto-renew and cancel terms, Restore purchases, Terms and Privacy links (ADR-0109 decision 5). **Not yet checked on a signed build** |
| 4.8 sign-in | Sign in with Apple is offered alongside Google and email |
| 5.1.1(v) account deletion | In-app deletion exists in code (PR 1218), off until S-2. **Do not submit before it works end to end** |
| 5.1.2 privacy | Policy URL `https://veyrnox.ai/legal/privacy`; label matches the list above |
| Age rating | 18+ (matches the sign-in tick and the privacy policy) |

**Screenshots (6.7-inch iPhone, portrait)**: Home with credits, Create, a finished creation, Library, Buy credits, Account. Use the staging build with seeded demo data; no real person's content.

## 7. Order of work

1. Owner: O1, O2, O3, O6 (accounts and keys), then the mobile session commits the project id (O3) and fills `submit` (M-6).
2. Owner: O4 and O5 (products), O7 (Supabase Apple client id).
3. After PR 1218: M-1 in `preview`; owner turns on S-2 in staging; run the deletion ready, blocked and erase paths on a throwaway staging account (this proves ADR-0111 end to end).
4. First **preview** build (`eas build --profile preview --platform ios`) to a real device through TestFlight internal testing. Prove: Apple and Google sign-in, a **sandbox purchase and its refund** (closes the M6 gap), restore purchases, the paywall terms (section 6), report, deletion, crash report reaches Sentry.
5. After PRs 1216 and 1219: M-2, M-3, M-4 and a second internal build; prove links and push on the device.
6. Owner: S-1, S-3, S-4 for production, then the **production** build and TestFlight **external** review. Record the result (the M7 done-condition).
7. Android after iOS: O11, a Play internal testing track, the same proofs.

## 8. Review risks to decide before submitting

- **No block control.** Acceptable only if reviewers accept that the app shows nothing from other users. If Cinema (M9) ships first in any build, block and mute must ship with it.
- **Credits are forfeited on deletion with no refund** (ADR-0111). Say so on the delete screen (done) and in the Terms.
- **Pricing parity.** Store prices mirror the web (ADR-0109), so the store keeps 15 to 30 percent. A price uplift is an owner option.
- **AI content rejection** is the main schedule risk (ADR-0108). Submit to TestFlight external review early to learn it before the public review.
