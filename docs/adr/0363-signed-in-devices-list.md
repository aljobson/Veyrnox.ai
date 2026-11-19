# ADR-0363: Signed-in devices list with per-device sign-out

Status: accepted (pending owner approval of migration 0565 and review)

## Context
The Account security card on web and phone offered only "Sign out other devices" and "Sign out everywhere". A person with one lost phone could not remove it without ending every session. Supabase Auth exposes no user-facing list of sessions; they live in `auth.sessions`.

## Decision
- Migration 0565: `public.list_account_sessions(p_auth_id)` and `public.revoke_account_session(p_auth_id, p_session_id)`. SECURITY DEFINER, `search_path = ''`, revoked from PUBLIC/anon/authenticated, granted to service_role only. Both act only on rows of the account id the Worker passes in.
- `GET` and `DELETE /api/v1/account/sessions` behind the normal middleware identity. DELETE checks Origin / Fetch Metadata and a UUID body id. Answers `ended:false` for an unknown or foreign id (a replay and a guess look the same).
- Who can see or end a session does not change: a person can see and end only their own sessions, as they already could in bulk.
- Privacy: no IP address and no raw user agent leave the database or the route. The list shows a rough label (browser and system, or the Veyrnox app), last-used time and a "This device" marker. "Rough location" is deliberately left out.
- "This device": the client compares the `session_id` claim of its own access token with each row; the server does not need to know it, and the current device has no per-row sign-out button (the existing Sign out covers it).
- Deleting an `auth.sessions` row stops refresh at once; an access token already issued works until it expires, the same limit as the existing bulk buttons (the help text says so).
- No feature flag: the Worker is at its binding cap, the two bulk buttons are unchanged, and before 0565 is applied the list shows its error state (route answers 503 `sessions_unavailable`).

## Consequences
Migration is applied only by the `apply-migrations` workflow after the owner approves. Rollback is a Worker rollback; the functions are harmless if unused. 11 web locales and 11 phone locales gain `app.account.devices.*` / `acct.dev.*` keys.
