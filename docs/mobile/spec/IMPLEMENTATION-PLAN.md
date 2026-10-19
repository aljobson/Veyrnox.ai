# Implementation plan: Veyrnox.ai mobile app

**Status:** Proposed 2026-10-19, against `main` at `4768d535`. This is the build sequence; [../PLAN-2026-10-18.md](../PLAN-2026-10-18.md) is the status and ownership picture, and [../USER-JOURNEY-2026-10-19.md](../USER-JOURNEY-2026-10-19.md) is the detail behind slices N1 to N8. It supersedes the slice table in `ROADMAP-2026-10-17.md`, whose numbering drifted.
**Rule:** one slice, one PR, each with an exit gate. No flag is enabled by an assistant. A mobile slice never edits server code, migrations or `wrangler.jsonc`.

## 1. Foundation (done)

| Slice | What | PRs |
|-------|------|-----|
| M0 to M3 | Sign-in, balance, chat, generation, jobs, Library, store billing | #1176, #1187 and neighbours |
| M4 | Release plumbing, EAS profiles, CI, crash reporting | #1204 |
| M5, S1 | Account, deletion, report, age gate | #1205, #1218 |
| S2, S3 | Push tokens, app links | #1219, #1216, #1230, #1231 |
| M8 | Cache, offline, 11 locales, accessibility | #1267 to #1272, #1286, #1287 |
| M9 | Cinema free viewing | #1251 |
| M10 | Create with files, Auto Short, video agent, templates, delete, referrals, quick edit | #1249, #1259, #1262, #1263, #1266, #1252, #1293, #1296 |
| M11 | Publish overview, compose, brand switcher, approvals, calendar, connect | #1269, #1273, #1300, #1301, #1306 |
| M12 | Credit history, allowance, help, appeals | #1274 to #1276 |
| M13 | AI consent, privacy manifest, report and block audit | #1278 to #1280 |
| S4, S10 | Publish connect return, block members | #1295, #1294, #1307, #1308 |

## 2. Track A: owner prerequisites (gate everything that ships)

| # | Step | Needed for |
|---|------|------------|
| A1 | App Store Connect API key, in-app purchase products, RevenueCat iOS key, Sentry project, review account on production | First TestFlight build |
| A2 | Free a production var slot, then flip `STORE_BILLING_ENABLED` and the push flag | Purchases and push in production |
| A3 | Apple sandbox tester, staging review account, account-deletion flag confirmed on staging | Device pass |
| A4 | Register `https://veyrnox.ai/social/connect/mobile/<network>` for YouTube, LinkedIn, X, TikTok | A real Publish connect |
| A5 | Play Console app, Play signing fingerprint into `lib/mobileAppLinks.js` | Android |

## 3. Track B: navigation and first run (mobile session)

Order matters; N1 runs alone because it rewrites shared layout files.

| Slice | Work | Exit gate |
|-------|------|-----------|
| N1 | Five-tab shell, Credits chip, avatar to Account; screens moved unchanged | Every current screen reachable; tests and typecheck pass; tab bar labelled (ADR-0133) |
| N5 | Result next steps: Edit, Publish, Make another carry the file | Each opens its target with the file; tested |
| N4 | Explore as home: prompt box, presets, Oddlings banner, pick up where you left off | A new person makes something in two taps |
| N8 | Vey mascot as the chat entry; Chat button leaves Home | Opens the sheet; never covers tab bar, keyboard, player or composer |
| N3 | First run: intro cards, credits explanation with the real free amount, permissions in context | Shown once, skippable, resettable |
| N2 | Signed-out preview of Explore and the Cinema list | Cold launch without an account shows content; play, create and buy ask to sign in |
| N6 | Empty states and a low-balance prompt | No blank screen without a next action |
| N7 | New-person walkthrough on a real phone, install to a scheduled post, with screenshots | A dated note listing every stall; each stall filed as a bug |

## 4. Track C: prove it on a device

| Step | Exit gate |
|------|-----------|
| C1 Run the 16 checks in `DEVICE-PASS-2026-10-18.md` on a signed `preview` build (iPhone) | Every check recorded pass or fail; failures fixed one PR each |
| C2 Real sandbox purchase, restore and refund | `reconcile_top_ups()` returns zero rows |
| C3 Cinema HLS 20-minute soak | No stall at token renewal; fallback decided |

## 5. Track D: ship

| Step | Exit gate |
|------|-----------|
| D1 TestFlight external review (iOS) with `submit.production` filled in | Review result recorded; review notes quote only passed checks |
| D2 Store billing on in production | Flag on, 24 hours of clean reconciliation |
| D3 Android parity pass and Play internal testing | Checks 1 to 9 and 13 to 16 pass on a Pixel-class phone |
| D4 Public store release | Owner decision; privacy label and Data safety forms match section 6 of the M7 checklist |

## 6. Track E: after the first release

| Work | Gate |
|------|------|
| Film Studio runs | A route survey note first, then a slice |
| Paid Cinema (Pass, unlocks, credit subscriptions) in the app | Own ADR and in-app purchase plan first (server S5) |
| Publish extras (queues, inbox) | Owner decision on whether they belong on the phone |
| Oddlings screen | Owner decision |
| Light theme | Owner decision |

## 7. Risks

1. **Store review on content:** Apple 1.2 and the Google AI-content policy. Block, report and consent are built; paid Cinema and anything new that shows other people's content re-opens it.
2. **Billing cap:** production vars are at the binding limit; every new server flag needs a slot first.
3. **Unproven on a device:** bot check, sandbox purchase and refund, HLS under signed tokens, push. Each has a fallback; none is proved.
4. **One developer identity:** the wallet and this app share the Apple team and Play account. The hard wall applies to every screen and listing.
5. **Parallel sessions:** two sessions editing `apps/mobile` collide. Lanes are in the plan; a message, not an edit, is the way across.
