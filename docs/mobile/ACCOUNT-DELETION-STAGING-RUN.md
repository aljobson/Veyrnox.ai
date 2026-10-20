# Account deletion: staging flip and test

**Status:** Proposed 2026-10-20, from `docs/adr/0111-account-deletion.md`, `docs/mobile/M7-STORE-SUBMISSION-CHECKLIST.md` (S-2, S-4, M-1) and the code on `main`. Nothing here has been run: no environment has the server flag on, so the ready, blocked and erase paths have never executed end to end.
**Why it matters:** Apple 5.1.1(v) and Google Play need in-app deletion. The app screen and the server routes are built; both are switched off. The 2026-10-20 walkthrough saw "coming" because the flags are off, not because the work is missing.
**Rule that stays:** flags change only on the owner's explicit words. An assistant does not flip one, apply a migration on production, or read production.

## Before you start

| Check | Why |
|---|---|
| Migration `0347_account_deletion` is applied on **staging** (staging is applied by hand, name = file stem) | Without it the route answers 502 `deletion_unavailable` |
| A staging test account you can lose, with a few credits and one finished creation | The run erases it for good |
| A second test account for the blocked path (see step 5) | A blocker needs a state you can set up |
| Staging is at the Cloudflare text-binding limit (128) | `ACCOUNT_DELETION_ENABLED` costs one binding; remove a flag you do not need or the deploy fails |

## Flip (owner)

1. **Server, staging only:** set `ACCOUNT_DELETION_ENABLED` to `"true"` in the Cloudflare dashboard. It is not in `wrangler.jsonc` (CLAUDE.md, binding cap). A dashboard edit can put the newest upload live, so afterwards confirm the live version is the one you meant.
2. **App, preview build:** add `"EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED": "true"` to the `preview` profile env in `apps/mobile/eas.json` (M7 item M-1) and make a new preview build. The flag is read at build time, so an installed build will not change. Leave `production` alone.

## Test (staging build, test account)

| # | Do | Expect |
|---|---|---|
| 1 | Account, tap **Delete my account** | The screen opens and shows "Checking your account", not "not available yet" |
| 2 | Read the screen | It states how many credits and Free Credits you lose, and asks you to type `DELETE` |
| 3 | Tap the red button before typing | It stays off |
| 4 | Type `DELETE`, confirm | "Deleting…", then you land signed out |
| 5 | Sign in again with the same email | A new empty account with **no** 10-credit sign-up grant (the email hash blocks a second grant) |
| 6 | Signed out of the erased account: reuse an old access token against `GET /api/v1/account` | Unknown account, not data |
| 7 | **Blocked path**, second account: start a creation and open Delete while it runs | "Not yet" with "A creation is still running" and no token. Repeat with an active plan |
| 8 | **Expiry path:** open the confirm screen, wait over 15 minutes, then type `DELETE` and confirm | "That took too long. Please confirm again." and the screen reloads with a fresh token |
| 9 | Ask for the preview six times in an hour | The sixth answers "too many times", with a wait |

## Read back afterwards

- `account_deletions` has one row for the erased account, with the forfeited amounts.
- The user row is a tombstone: `deleted-<id>@erased.invalid`, `deleted_at` set, balance and ledger unchanged.
- `reconcile_balances()`, `reconcile_free_credits()`, `reconcile_top_ups()` return zero rows.
- The Supabase Auth user is gone; the test account's generated files are queued in `asset_reap_queue` and leave R2 within the reaper's cycle.

## Not covered

- Production. Turning it on there needs the owner's word, 0347 applied by the `apply-migrations` workflow, and the privacy-policy sentence about the email hash (ADR-0111, Rollout).
- Cinema, Publish teams and saved projects as blockers: the app tells the person to remove them on the website; withdrawal inside the app is a later slice.
- Revoking the grant at Instagram, TikTok and the other networks: only our copy of the token is destroyed.
- Android, and the Apple and Google store submission itself (M7).
