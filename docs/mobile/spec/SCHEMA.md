# Schema: data and identity for the mobile app

**Status:** Proposed 2026-10-19. Table and migration names come from `packages/db/schema/supabase/` file and `CREATE TABLE` names on `main` at `4768d535`; the SQL bodies were not re-read, so column lists are not repeated here. ADRs 0108, 0111, 0113, 0116 and 0135 are the authority.
**Reads with:** [TRD.md](TRD.md), [APP-FLOW.md](APP-FLOW.md), [../../../CLAUDE.md](../../../CLAUDE.md) "Database".

The mobile app has **no database of its own and writes no table directly.** Everything it changes goes through `/api/v1` and the RPCs behind it. This document lists what the app stores on the phone, what server tables its features touch, and who may write them.

## 1. Identity and sign-in flow

1. Supabase Auth is the only identity source. Providers: Apple, Google, email and password.
2. iOS Apple: native sheet, identity token exchanged at `/auth/v1/token?grant_type=id_token` (hashed nonce to Apple, raw nonce to Supabase).
3. Google, and Apple on Android: system browser, PKCE (`/auth/v1/authorize`, then `grant_type=pkce`), returning through `<apiBase>/auth/mobile` to `ai.veyrnox.app://auth/callback`.
4. Email: password grant with the hidden bot check (ADR-0026).
5. The access token lives in memory. The refresh token lives in Keychain or Keystore. A 401 triggers one single-flight refresh and one retry.
6. The `auth.users` to `public.users` and `credit_balances` triggers (0010, 0071) are the only path that provisions a user. The signup grant follows email confirmation. The app creates no user rows.

## 2. On the phone

| Store | Holds | Notes |
|-------|-------|-------|
| `expo-secure-store` | Refresh token | Keychain `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` |
| Memory | Access token, in-flight request state | Never persisted |
| App cache (`appCache`) | Balance, Library list, model list, saved per user id | Stale-while-revalidate; cleared on sign-out and account deletion |
| Consent store (`aiConsentStore`) | That the AI processing agreement was accepted, with its wording version | Per install and account |
| Push token | Registered with the server on sign-in, removed before sign-out | Server copy is authoritative |
| First-run flag *(new, N3)* | That the intro was shown | Local only; resettable from Account |
| Draft key (`draftKey`) | An unsent composer or prompt draft | Local only |

Nothing the app caches may contain a signed asset URL beyond its 15-minute life, and no cache outlives sign-out.

## 3. Server tables the mobile features touch

| Table or function | Migration | Written by | Mobile feature |
|-------------------|-----------|------------|----------------|
| `credit_balances`, `ledger_entries` | earlier | RPCs only (`ledger_debit`, `ledger_refund`, `ledger_grant`, `credit_top_up`, `apply_top_up_refund`, and the others in CLAUDE.md) | Balance, history, every paid action |
| `jobs`, `model_catalog` | earlier | `/api/v1/generations`, webhooks | Create, job status, Library |
| `jobs.deleted_at` through `delete_user_job` | 0351 | That RPC only | Delete a creation (ADR-0116) |
| `store_customers` and store provenance on top-ups | 0344 | RevenueCat webhook through `credit_top_up` and `apply_top_up_refund` | Credit packs (ADR-0108) |
| Store Publish subscription tables | 0346 | RevenueCat webhook | Publish Plan in the stores (ADR-0109) |
| `account_deletions` and the prepare, erase, complete functions | 0347 | Those functions only | Delete account (ADR-0111) |
| `push_tokens`, `push_outbox`, `push_token_writes` | 0348 | `register_push_token`, `remove_push_token`, `push_*` RPCs | Push for finished creations (ADR-0113) |
| `user_blocks` and `block_cinema_user`, `unblock_cinema_user`, `list_blocked_cinema_users` | 0353 | Those functions only | Block a Cinema member (ADR-0135) |
| `read_cinema_comments` | changed in 0353 | Read function | Comments hide blocked authors |
| `social_*` tables | 0229 to 0352 | `/api/v1/social/*` | Publish: accounts, posts, calendar, approvals |
| Workspace, project, document, asset tables | tenant projects | The user's own JWT through RLS (ADR-0051) | Projects, read-only on the phone |

Applied state: migrations through 0353 are applied on production as of 2026-10-18 for 0353 (workflow run approved by the owner); the earlier mobile migrations were applied before. Production was not read for this document.

## 4. Who may write what

- The app writes nothing directly. It calls routes; routes call RPCs.
- The ledger is append-only. A refund or clawback is a compensating row through its RPC; the app never sees a ledger write.
- Store purchases enter only through the RevenueCat webhook, verified by signature, deduplicated in `webhook_events(source, external_id)`.
- Every state-changing call carries an idempotency key; replay is a no-op.
- A table that holds a person's data and references `users` is erased with the account (trigger on `users.deleted_at`) and classified in `scripts/test-account-deletion.mjs`. `user_blocks` and the push tables are.
- Deleting a creation removes the file and the prompt and keeps the job row and every ledger entry. A reader of jobs must filter `deleted_at IS NULL`.

## 5. What the app must never hold

Service-role keys, provider keys, refresh tokens in logs or crash reports, another person's identity, a signed URL older than its life, or anything wallet-related.

## 6. New data for the navigation work

N1 to N8 add no table. N3 stores one local flag. N3 also needs the free-credit amount from an existing read: `GET /api/v1/free-allowance` and `GET /api/v1/balance` already return `free_credits`; confirm which one carries the signup amount before building (open question).
