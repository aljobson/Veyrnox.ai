# ADR-0111 — Account deletion

**Status:** Proposed 2026-10-18
**Related:** [ADR-0110](0110-mobile-account-and-safety.md) (the Account screen and its disabled button), [ADR-0013](0013-credit-expiry-policy.md) and [ADR-0064](0064-core-subscriptions.md) (credit buckets), [ADR-0083](0083-admin-operations-surface.md) (reports, holds), CLAUDE.md "Database" (append-only ledger, Frozen accounts), roadmap slice S1 (`docs/mobile/ROADMAP-2026-10-17.md`)

## Context

Apple (5.1.1(v)) and Google Play both require an app that lets people create an account to let them delete it from inside the app. The server has no deletion path: `/api/v1/account` is GET only, and the schema is built so that nothing about money can be removed.

- `public.users` is a shadow row keyed by the Supabase Auth id. Forty tables reference `users(id)` with `ON DELETE RESTRICT`, among them `ledger_entries`, `jobs`, `top_ups`, `account_actions` and the subscription tables. The ledger is append-only by trigger. A row delete is impossible by design, and should stay impossible.
- Refunds, disputes and tax records keep arriving after a person leaves. A Stripe refund for a top-up bought last month must still find its order, its user and its credits.
- A Frozen account (Chargeback) must not be able to leave by deleting itself.

## Decision

### 1. Deletion is a tombstone

`public.users` stays. On erasure its `email` becomes `deleted-<id>@erased.invalid`, its `auth_id` becomes `erased:<id>` (no token can ever match it again), and `deleted_at` is set. Everything that names the person or holds their content is erased; the money records stay on a row that names nobody.

### 2. What happens to each kind of data

| Data | Decision |
|---|---|
| **Ledger, `credit_balances`, `top_ups`, `store_customers`, referral rewards** | Kept, untouched. Legal and accounting need (refunds, disputes, tax). The retention period is the owner's and counsel's call; this ADR sets none and nothing deletes them. |
| **Credits (paid, Free, Subscription)** | **Forfeited, with a warning first.** No ledger row, no write to `credit_balances`: the balance stays on the tombstone, which nobody can sign in to, so `balance = SUM(ledger)` and every `reconcile_*()` keeps returning zero rows. The amounts are recorded in `account_deletions`. The preview call returns them so the app can say "you will lose N credits" before the person confirms. No refund of money is made by deleting. |
| **Frozen account** | **Refused** (`account_frozen`). A person cannot delete their way out of a dispute. The check runs again inside the erasure, under the balance row lock `ledger_debit` takes, so a freeze that lands between preview and confirm still blocks it. |
| **Held evidence** (an unreleased `evidence_holds` row, or an asset with `held_at` set) | **Refused** (`account_on_hold`). Preserved material is not erased on request. |
| **Subscriptions** (`credit_subscriptions`, `social_publish_subscriptions` active or past due, Stripe or store) | **Refused** (`active_subscription`). Neither we nor the store can bill a person who no longer exists, and deleting does not cancel an Apple or Google subscription. The person cancels first (Stripe through our cancel routes, a store plan in the store), then deletes. |
| **Generation or top-up in flight** | **Refused** (`generation_in_progress`, `top_up_in_progress`), so a result or a credit never lands on an erased account. |
| **Generated files** (`assets`, Film Library masters, Editor Library renders, upload reservations, Publish uploads not used by a published post) | Rows deleted and the R2 keys queued in `asset_reap_queue`, the existing reaper. The objects go within the reaper's cycle. |
| **Prompts** (`jobs.inputs`) | Replaced by `{}`. The job row, its state, model and credits stay (they back the ledger). |
| **Chat** (threads, messages, folders, personas, closed-send markers) | Deleted. |
| **Publish** (brands the person owns) | Provider tokens (`access_token_enc`, `refresh_token_enc`) are nulled and the account marked revoked, API keys revoked, webhook endpoints deleted, drafts and scheduled posts deleted, the brand label replaced by "Deleted brand". Published-post history stays (it is already public on the networks). A brand with other members is **refused** (`publish_team_present`): there is no ownership transfer yet. We stop holding the credential; the app grant on the network side is the person's to remove there. |
| **Cinema** | Profile, membership, creator application, follows and saved titles deleted. A person with Cinema titles or live uploads is **refused** (`cinema_content_present`) until Cinema has its own withdrawal path in the app (roadmap M9). Cinema is not on sale in production. |
| **Tenant projects** (organisations, workspaces, projects owned by the person) | A person with a live project is **refused** (`projects_present`) and deletes the project first (the project routes already do that). Membership rows in other people's projects go with the Auth user. |
| **Referrals** | The person's referral code is deleted so nobody can sign up under it. `referrals` and `referral_rewards` stay: ids only, and the referrer's reward accounting depends on them. |
| **Reports and appeals** | Kept; the reporter or appellant is a tombstone id. |
| **Rate-limit counters, admin and audit actor columns** | Kept; ids only. |
| **Supabase Auth user** | Removed by the Worker through the Auth admin API with the service role (hard delete, so sessions, identities and refresh tokens go). |

### 3. Free credits are not renewable by deleting

An erased account keeps a SHA-256 of its lowercased email in `account_deletions` for one purpose: `signup_grant` skips the 10-credit grant for an email that has an erased account, so delete-and-resign-up is not a way to collect Free Credits again (otherwise the ADR-0013 sign-up faucet reopens through the new route). `signup_grant` becomes a wrapper around the previous body, now `signup_grant_base`. A hash of an email is still personal data, kept on the ground of fraud prevention (legitimate interest) and stated in the privacy policy before this is enabled.

### 4. Two steps, a confirmation that cannot be guessed or replayed by a script

1. `POST /api/v1/account/deletion` returns what would be forfeited, any blockers, and (only when none) a `confirmation_token`: 256 random bits, stored as a SHA-256, valid 15 minutes, bound to the account that asked. Five per hour per account, then 429.
2. `DELETE /api/v1/account` with `{ confirmation_token }` erases in one database transaction, then removes the Auth user, then marks the record complete.

The app is expected to put the credit-loss warning and a deliberate confirm between the two calls. A token is not a re-authentication; it makes a script or a stolen session pay for two calls and a typed confirmation in the UI, and it is single use. Re-authentication (a fresh sign-in inside the app) is a UI decision the app can add in front of step one with no server change. We do not read the JWT's `iat`: a refresh token mints a new access token every hour without a sign-in, so it says nothing about recency.

### 5. Idempotent, and safe to retry at every stage

- The same token again returns the first result (`replayed: true`) whatever stage it reached.
- The data erasure is one transaction. A reference nobody listed (`foreign_key_violation`, `restrict_violation`) rolls the whole block back and returns `deletion_blocked`; nothing is half erased.
- If removing the Auth user fails after the erasure, the answer is 502 `deletion_incomplete` and the same request finishes the job. Until then the person can still sign in to an empty account.
- The erased `auth_id` does not match anything, and no `/api/v1` handler provisions a user row, so an access token that outlives the deletion (up to an hour) reads as an unknown account everywhere.

### 6. Rollout

Off until `ACCOUNT_DELETION_ENABLED` is `"true"`. Production vars are at the 77-binding cap, so the flag is **not** added to `wrangler.jsonc`; unset means off (404, after the auth check). Staging sets it to test with the mobile app. Turning it on in production needs the owner's word, migration 0347 applied by the `apply-migrations` workflow, and the privacy policy sentence about the email hash. Nothing in this ADR enables it.

## Rejected

- **Hard delete of `public.users` with cascades.** Blocked by the ledger's RESTRICT references and the append-only trigger; if forced, it would destroy the records refunds and disputes need.
- **A ledger row to zero the forfeited credits.** Adds a new reason and a new writer to the money spine for a balance nobody can spend. Recording the amount in `account_deletions` gives the audit trail without touching the invariant.
- **Deleting a subscriber's account and cancelling the subscription for them.** We cannot cancel Apple or Google subscriptions from the server, and an automatic Stripe cancel would forfeit a paid period without being asked. Refusing with a clear code is honest and recoverable.
- **Waiting out a grace period before erasure.** Stores do not require one and it keeps personal data longer; a person who wants it back can sign up again.
- **A signed token instead of a stored one.** It would need a new secret binding, which the production cap does not allow.

## Not decided here, owner or later slice

1. **Retention periods** for the kept money and safety records, and whether credits forfeited by a paying customer need a specific notice in the terms.
2. **Publish inbox, smart links and analytics** for brands the person owned are kept, de-identified by the brand label only. They can hold other people's messages. A retention sweep for them is owed before this goes to production, and is a legal call on how long.
3. **Cinema titles and tenant projects** block deletion; the in-app withdrawal and project-delete paths belong to M9 and later mobile slices.
4. **Columns that name a person without a foreign key** (for example `cinema_comments.author_id`, moderation `actor_id` columns): the drift guard in `scripts/test-account-deletion.mjs` covers foreign keys only. Cinema is off in production; these need their own pass before Cinema opens.
5. **Revoking the grant at the network** (Instagram, TikTok and the rest) is not done server-side; only our copy of the token is destroyed.

## Consequences

- Migration 0347: `users.deleted_at`, `account_deletions`, `prepare_account_deletion`, `erase_account`, `complete_account_deletion` (service role only), `private.account_deletion_blockers`, and the `signup_grant` wrapper.
- `scripts/test-account-deletion.mjs` (in `ledger-tests.yml`, against the full replay) proves: the erasure and what stays; the ledger and balance unchanged and all four reconcile functions clean; replay at every stage; Frozen, hold, subscription, in-flight and team refusals, including a freeze that lands after the token; expiry and the rate limit; no second sign-up grant; only the service role may call anything; and a guard that fails when a new table references `users` without being classified here.
- `tests/accountDeletionRoute.test.mjs` and `tests/identityHeaders.test.mjs` cover the routes, the 401 before any outbound call, and the flag.
- The Account screen (ADR-0110) can wire its disabled button to these two calls.
