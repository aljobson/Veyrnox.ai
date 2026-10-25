# Schema: data and identity for the mobile app

**Status:** Source refresh 2026-10-20 against checkout HEAD `df14bedb`; live deployment and device behaviour not verified.

**Evidence boundary:** Source baseline and PR-query evidence are recorded in [README.md](README.md). Paths beginning `src/` are relative to `apps/mobile/`; other repository paths are relative to this checkout. Configuration states are source values, not a live environment inspection; see [TRD section 3](TRD.md#3-configuration-and-flags).
**Reads with:** [TRD.md](TRD.md), [APP-FLOW.md](APP-FLOW.md), [../../../CLAUDE.md](../../../CLAUDE.md) "Database".

The mobile app has **no database of its own and writes no table directly.** Application data changes go through `/api/v1` and its server handlers/RPCs. Identity and security operations call Supabase Auth `/auth/v1` directly (`src/lib/auth/accountCalls.ts`, `src/lib/passkeys.ts`); public preview/review-link calls and signed-media transfers are other explicit exceptions to gateway routing. This document lists what the app stores on the phone, what server tables its features touch, and who may write them.

## 1. Identity and sign-in flow

1. Supabase Auth is the only identity source. Providers: Apple, Google, email and password.
2. iOS Apple: native sheet, identity token exchanged at `/auth/v1/token?grant_type=id_token` (hashed nonce to Apple, raw nonce to Supabase).
3. Google, and Apple on Android: system browser, PKCE (`/auth/v1/authorize`, then `grant_type=pkce`), returning through `<apiBase>/auth/mobile` to `ai.veyrnox.app://auth/callback`.
4. Email: password grant with the hidden bot check (ADR-0026).
5. The access token lives in memory. The refresh token lives in Keychain or Keystore. A 401 triggers one single-flight refresh and one retry.
6. Account security now includes password reauthentication, logout scope, OAuth grants, TOTP factors and existing passkeys. These use the user token directly against Supabase Auth; no service role key is shipped. Passkey enrolment/sign-in remains blocked on S2.
7. The `auth.users` to `public.users` and `credit_balances` triggers (0010, 0071) are the only path that provisions a user. The signup grant follows email confirmation. The app creates no user rows.

## 2. On the phone

| Store | Holds | Notes |
|-------|-------|-------|
| `expo-secure-store` | Refresh token | Keychain `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` |
| Memory | Access token, in-flight request state | Never persisted |
| App cache (`appCache`) | Per-account balance/Library, favourites, Create draft and imported Film Studio; public model catalogue | `Paths.cache/veyrnox-cache`; stale-while-revalidate; cleared on sign-out, account change and account deletion |
| Consent store (`aiConsentStore`) | That the AI processing agreement was accepted, with its wording version | Per install and account |
| Push token | Registered with the server on sign-in, removed before sign-out | Server copy is authoritative |
| First-run flag (built, N3) | `veyrnox.welcome.seen.v1`, version and seen boolean | SecureStore, install-local; Account reset control not implemented; not a server preference |
| Draft key (`src/lib/draftKey.ts`) | Publish submission signature and idempotency key | Persisted before submission, per account; does not itself store the composer form |
| Create draft (`src/lib/createDraftStore.ts`) | Unsent Create form text/options | Per-account cache, seven days; no media bytes |
| Film Studio (`src/lib/filmStudioStore.ts`) | Validated imported web JSON, read-only | Per-account cache, 90 days; reparsed on read, removed on sign-out/account change/deletion; not cloud sync |
| Library favourites (`src/lib/libraryView.ts`) | Starred job IDs | Per-account cache, 365 days; local only |
| Saved Oddlings and builder draft (`src/lib/oddlingsAccountStore.ts`) | Server copy in the person's Projects as a v4 document (ADR-0246); per-account `userDocStorage` record `oddlings.v1` with base/local collections, generation-tagged operations, link generation, exact in-flight request, bounded orphan requests, complete creation intent and recoverable deleted-project collection | Cache wiped on sign-out, session loss, account change and deletion; unsent saves are local only. Legacy file is claimed once, with one install ownership marker in SecureStore (`veyrnox.oddlings.legacy.v1`) deliberately retained across these wipes; no media bytes |

Cache retention above is read from `src/lib/cache.ts`; account cache clearing is in `src/lib/appCache.ts`. Signed-media lifetime must be enforced independently of cache retention. A complete cache payload/URL audit is **not verified**; the install-local welcome flag is not account data and may outlive sign-out.

**Oddlings retention:** Saves land in the account's durable document cache before any network request. Builder draft autosaves remain local until leaving the visit; at most one draft revision is sent per visit, while each explicit Save is a permanent revision. A new passport at the local 24-item cap is refused rather than dropping the oldest. Merging a remote collection beyond 24 items or 32 KiB leaves unsent edits on the phone with a full-project notice. Pending operations survive restarts and are retried by screen events, with no background task. Signing out or losing the session removes unsent saves, as stated in the row accessibility hint. The existing `bindCacheUser` sweep and `wipeCache` clear `userDocStorage` on account change, sign-out, session loss and successful account deletion.

The retired `Paths.document/veyrnox-oddlings/passports.json` is read only by the claim-once adopter. Before reading it, SecureStore records `claiming:<userId>`; after merging it, deletion is attempted and the marker becomes `done:<userId>`. Unavailable SecureStore fails closed. Only that account can resume a claim; another account never reads the file, even if deletion failed and caches were wiped. The one marker string deliberately outlives cache wipes. Link generations prevent old responses changing a new selection. Exact orphan requests replay only to their original projects, with no operations transferred; at most three are kept for thirty days. Expiry or definitive failure reports that earlier changes were not saved. An unresolved orphan may or may not exist on the server and is not recoverable after eviction. Creation intents retain nonce, key, workspace, normalized name, selection generation and creation time; matching responses clear the slot, and only an unchanged selection generation links the result. Ambiguous creation is bounded to twenty-four hours or Start over; it may leave an unlinked empty project, removable in Projects. The phone never automatically deletes a project. A confirmed missing project retains its current collection as `recoverable`; choosing another offers Bring (default) or Start empty with confirmation. Ordinary switching carries only pending operations not captured by an unresolved request. Device behaviour and OS backup/uninstall retention of `Paths.document` and the ownership marker are **not verified**.

## 3. Server tables the mobile features touch

| Table or function | Migration | Written by | Mobile feature |
|-------------------|-----------|------------|----------------|
| `credit_balances`, `ledger_entries` | earlier | RPCs only (`ledger_debit`, `ledger_refund`, `ledger_grant`, `credit_top_up`, `apply_top_up_refund`, and the others in CLAUDE.md) | Balance, history, every paid action |
| `jobs`, `model_catalog` | earlier | `/api/v1/generations`, webhooks | Create, job status, Library |
| `jobs.deleted_at` through `delete_user_job` | 0351 | That RPC only | Delete a creation (ADR-0116) |
| `store_customers` and store provenance on top-ups | 0344 | RevenueCat webhook through `credit_top_up` and `apply_top_up_refund` | Credit packs (ADR-0108) |
| Store Publish subscription tables | 0346 | RevenueCat webhook | Publish Plan in the stores (ADR-0109) |
| Store AI Generation subscription identity and product map | 0393 | RevenueCat webhook through `apply_store_generation_event` | Generation entitlement and recurring credit grants |
| Launch mobile pack catalog and Google Play base-plan mappings | 0394 | RevenueCat webhook | 100/300/1,000-credit packs plus exact Android Generation and Publish identifiers |
| `account_deletions` and the prepare, erase, complete functions | 0347 | Those functions only | Delete account (ADR-0111) |
| `push_tokens`, `push_outbox`, `push_token_writes` | 0348 | `register_push_token`, `remove_push_token`, `push_*` RPCs | Push for finished creations (ADR-0113) |
| `user_blocks` and `block_cinema_user`, `unblock_cinema_user`, `list_blocked_cinema_users` | 0353 | Those functions only | Block a Cinema member (ADR-0135) |
| `read_cinema_comments` | changed in 0353 | Read function | Comments hide blocked authors |
| `social_*` tables | See existing social migrations; complete range **not verified** | `/api/v1/social/*` | Publish including queues/autolists, contacts, SmartLink, ad drafts/products, reports, team and developer surfaces |
| `cinema_watch_resume`; `save_cinema_watch_resume`, `list_cinema_watch_resume`, `remove_cinema_watch_resume` | 0355, ADR-0232 | Service-only RPCs behind `/api/v1/cinema/progress`; owner is middleware identity | Continue watching server #1434 merged; phone #1452 in review; activation pending |
| `model_catalog` Face Filters rows | 0356 staging; 0357 activation (#1439) | Migration SQL | Activation merged on main: A1/A2/A4/A5 active; A3 relight inactive; A6–A8 absent. Production application **not verified from the repo**; dedicated phone UI #1453 in review |
| Workspace, project, document, asset tables | tenant projects | The user's own JWT through RLS (ADR-0051) | Projects, read-only on the phone |

Applied state is **not verified** from a database. The earlier spec reported 0353 applied on 2026-10-18; that is historical evidence only. The frozen work order says 0355 is unapplied and ADR-0232 says activation pending. Both source environments omit `watchProgress` and `CINEMA_WATCH_PROGRESS_ENABLED` (`wrangler.jsonc`, interpreted by `lib/cinema/features.js`), so the route fails closed before database access. No migration was applied for this refresh.

Film Studio web drafts live in account-scoped browser storage, not tenant Projects (`docs/product/film-studio.md`). The phone has a read-only imported copy. Cross-device discovery/list/open requires new server persistence; the existing Projects tables cannot be described as a Film Studio backend.

## 4. Who may write what

- The app writes no application tables directly. It calls application routes and Supabase Auth endpoints; server handlers/RPCs own database changes.
- The ledger is append-only. A refund or clawback is a compensating row through its RPC; the app never sees a ledger write.
- Store purchases enter only through the RevenueCat webhook, verified by signature, deduplicated in `webhook_events(source, external_id)`.
- Paid submission retries use idempotency keys. Do not generalise this to every mutation: Continue watching uses absolute upserts without an idempotency key (ADR-0232); Auth endpoints follow Supabase contracts.
- A table that holds a person's data and references `users` is erased with the account (trigger on `users.deleted_at`) and classified in `scripts/test-account-deletion.mjs`. `user_blocks` and the push tables are.
- Deleting a creation removes the file and the prompt and keeps the job row and every ledger entry. A reader of jobs must filter `deleted_at IS NULL`.

## 5. What the app must never hold

Service-role keys, provider keys, refresh tokens in logs or crash reports, another person's identity, a signed URL older than its life, or anything wallet-related.

## 6. New data for the navigation work

N1 to N8 add no application table. The built N3 welcome stores the install-local seen flag and reads current `free_credits` from `GET /api/v1/balance` (`src/lib/firstRun.ts`, `src/app/(app)/welcome.tsx`). This is the available balance, not a hard-coded signup grant. Create drafts, favourites and Film Studio imports add per-account cache policies only; Oddlings adds a per-account durable document cache and v4 Projects copies, plus an install-level SecureStore legacy ownership marker (section 2). Continue watching is separate server work in migration 0355, with phone integration #1452 in review.
