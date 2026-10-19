# Real-device pass (iOS first)

**Status:** Proposed 2026-10-18. Supersedes the "not proved yet" list in [M7-STORE-SUBMISSION-CHECKLIST.md](M7-STORE-SUBMISSION-CHECKLIST.md) section 2 as the thing to run; that file's owner steps (O1 to O11) still apply.
**Reads with:** [PLAN-2026-10-18.md](PLAN-2026-10-18.md), ADR-0106, 0108, 0109, 0113, 0128, 0129, 0133.
**Why:** every item below works in tests or on a simulator, and none has been seen on a signed build on a real phone. Store review will exercise most of them.

**Setup**
- A real iPhone, a `preview` EAS build (staging API), a staging test account with some Credits. Android: a Pixel-class phone and the same checks after Play internal testing exists.
- Record each result in a dated note under `docs/mobile/` (pass, fail, what you saw). A failing item is a bug for the mobile session, not a reason to skip the rest.
- Do not use a production account, a real card, or a real social account for these.

| # | Check | Steps | Pass means | Fallback if it fails |
|---|-------|-------|------------|----------------------|
| 1 | Email sign-in with the bot check | Fresh install, sign in by email | The hidden check completes and you land signed in | Use the review test account; log the stall |
| 2 | Sign in with Apple | Tap Apple on a device with an Apple ID | Signed in; account shows the same Credits on a second sign-in | Google or email |
| 3 | Google sign-in | Tap Google | Browser sheet returns to the app signed in | Email |
| 4 | Buy a credit pack (sandbox) | Credits, buy the smallest pack with a sandbox Apple account | Balance rises after the webhook, within about a minute | Check RevenueCat events, then staging webhook log |
| 5 | Restore purchases | Delete the app, reinstall, sign in, Account, Restore | Entitlements and balance unchanged, nothing credited twice | |
| 6 | Refund (sandbox) | Request a refund of check 4 in Apple's sandbox | Credits are taken back; `reconcile_top_ups()` returns no rows | If the sandbox gives no refund, say so; do not claim it proved |
| 7 | Publish Plan paywall | Open Publish | Price, period, renewal terms, Restore, Terms and Privacy links all show | |
| 8 | Create with a photo | Create, pick a photo, run a model | Consent sheet appears first; the job finishes; result opens in Library | |
| 9 | Save and share | Open a finished image and video; Save to Photos; Share | Photos permission prompt appears once; file is in Photos | |
| 10 | Push | Start a video, background the app | A notification arrives when it finishes; tapping opens the job. Requires the push flag on staging | Polling still works when the app is open |
| 11 | App links | Tap a `veyrnox.ai/app/...` link from Notes | The app opens on that screen | Needs the Apple Team ID in `lib/mobileAppLinks.js` |
| 12 | Cinema playback | Play a free title for 20 minutes | No stall at the token renewal; seeking works | Web view fallback from the spike note |
| 13 | Offline | Airplane mode, then open Library and Create | Cached Library shows with a banner; paid actions refuse to start | |
| 14 | Delete account | Account, Delete, on a throwaway account | Signed out; signing in again fails; the owner confirms the tombstone | Flag must be on for the target environment |
| 15 | Accessibility | VoiceOver on sign-in, Create, Account; Larger Text at maximum | Everything reads and scrolls; no clipped buttons | |
| 16 | Report | Report a creation from Library | Confirmation shows; the report appears in the admin list | |

**After the pass**
1. Fix anything red, in the mobile session, one PR per bug.
2. Only then submit to TestFlight external review (M7). Quote the passed checks in the review notes and nothing that is not in the table.
3. Repeat 1 to 9 and 13 to 16 on Android.

**Needs the owner before it can run:** an Apple sandbox tester account, the staging push flag, the review test account on staging.
