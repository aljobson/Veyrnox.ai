# ADR-0318 — Roles on the expanded admin panel

Date: 2026-11-02. Status: implemented for owner review; not deployed.

Migration 0428 adds owner, finance, support, moderator and viewer roles to the
new admin sections. `users.is_admin` remains the outer gate: a role alone grants
nothing. Existing routes retain [ADR-0078](0078-admin-checks-in-code.md)'s four
gates. Retrofitting those routes is a separate decision; hiding a link does not
change their authorization.

`admin_role_permissions` is the authoritative matrix; `lib/adminPermissions.js`
mirrors it and a test compares the complete matrices. Finance reads payments,
affiliates and plans but cannot write plans. Support reads users and changes and
operates support. Moderator retains existing moderation links. Viewer gets the
non-sensitive read tabs; roles, switches and support are excluded. Owner has
every registered permission. New routes request a specific permission, checked
again in SQL. Navigation receives explicit permissions, never a wildcard;
unbuilt tabs stay hidden.

Every current administrator becomes an owner exactly once. The backfill and
`admin_roles_init` receipt share a locked transaction block. Replaying after a
revocation or demotion preserves that decision. A later administrator needs an
owner to grant their role. Revocation never clears `is_admin`.

Role writes require `roles.write`, a printable 1–500-character reason, an
Idempotency-Key and AAL2 within 300 seconds. Only middleware-verified headers
populate `p_aal` and `p_mfa_at`. SQL locks the global mutation gate and identity
rows, rechecks authorization, and checks freshness again after the target-row
wait. A five-second future-clock tolerance follows the existing guarded mutation.
No owner may change their own role or remove the last active owner via these RPCs.

The additional internal `admin_mutation_receipts` table returns the exact original
result on replay. The primary key is (actor_user_id, idem_key), shared across admin
operations only. Lookup is actor-scoped, so another administrator may independently
use the same key and cannot discover its existence. Changed requests using an
actor's old key are refused. Customer intake uses separate erasable receipts (0432).
After authorization and lock waits, an exact receipt is returned before checking
MFA age; replay after 300 seconds has no write effect. New writes still require
fresh AAL2 in SQL. Routes validate verified AAL2/timestamp shape and forward an
expired proof for this receipt decision; they do not authorize an expired new write. Mutation,
append-only audit and receipt commit together. Initialization and mutation
receipts reject update/delete/truncate. All three tables force RLS and grant no
direct access, including to service_role. Entry-point RPCs are service-only;
internal lock/change helpers and the underlying S0 feed deliberately have no
direct service-role execution grant. No browser role receives access.

Authorization records and operator reasons are retained operational accountability,
classified in account-deletion tests. Account erasure tombstones the user and
removes effective access. These tables contain no customer support content;
operators must not put secrets in reasons. admin_roles (including granted_by),
runtime_switches.updated_by, admin_change_log.actor_user_id and admin mutation
receipts retain RESTRICT user FKs. Administrator accounts referenced by these
records are not hard-deletable by design; use prepare_account_deletion/erase_account
to tombstone them while preserving accountability. Normal customers creating
tickets acquire no admin receipt or audit FK and may be hard-deleted, with support
content and intake receipts erased first.

S0 is preserved behind a role-checking feed wrapper. Migration 0426 replaces only
the underlying admin_changes_feed_base and creates the public wrapper only when
absent. Replaying 0426 alone after 0428 therefore preserves the permission wrapper.
The changes acceptance script replays 0426 twice, compares the wrapper definition
and verifies a finance-role caller is still refused. Migration 0427 likewise
creates its initial admin_require_permission stub only when absent. The reporting
acceptance script verifies admin_has_permission remains in the function body after
0427/0428 replay and after replaying 0427 alone twice, then exercises role denials.

`tests/adminRoles.test.mjs` covers the matrix and trusted-header boundary.
`scripts/test-admin-panel-roles.mjs` is a host-run local rollback suite covering
first install, demotion/revocation replay, exact idempotency, MFA expiry after a
real lock wait, own/last-owner protection and privileges. JavaScript tests do
not prove SQL behavior; database execution remains required.

Revoking an existing user with no role returns the typed no-op `no_role` (HTTP 409), with no change-log entry or success receipt. Replaying a previously successful revoke still returns its original receipt before the missing-role check.

## Later administrators and break-glass owner recovery

An administrator created after 0428 has an empty role permission set until an owner assigns a role. Setting is_admin alone does not expose new tabs. Only an effective owner can assign roles through the application. The existing last-owner guard already counts only owners whose users row is is_admin, not frozen, and not deleted; it does not count an unusable owner as a recovery path.

If the last owner is frozen, deleted or no longer is_admin, an authorized database operator can promote a separately identity-verified, non-frozen, non-deleted account. Do not resurrect a deleted account or clear frozen_at directly. If the intended recovery account is frozen, resolve it through the existing unfreeze_account process first; otherwise choose another verified account. This is privileged operator SQL, not a service-role/browser RPC. The following psql runbook takes an existing auth UUID, refuses an unavailable candidate or any still-effective owner, serializes with role mutations, and records the recovery. Replace the prompt input only; no migration receipt is removed or replayed.

```sql
\prompt 'Verified recovery account auth UUID: ' recovery_auth
BEGIN;
SELECT pg_advisory_xact_lock(427,0);
SELECT set_config('veyrnox.recovery_auth', :'recovery_auth', true);
DO $$
DECLARE u public.users%ROWTYPE; previous_role text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_roles r JOIN public.users p ON p.id=r.user_id
      WHERE r.role='owner' AND p.is_admin AND p.frozen_at IS NULL AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'An effective owner exists; use the normal owner role workflow';
  END IF;
  SELECT p.* INTO u FROM public.users p JOIN auth.users a ON a.id::text=p.auth_id
    WHERE p.auth_id=current_setting('veyrnox.recovery_auth')
      AND p.deleted_at IS NULL AND p.frozen_at IS NULL
      AND a.email_confirmed_at IS NOT NULL AND NOT coalesce(a.is_anonymous,false)
    FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recovery account must be existing, confirmed, unfrozen and not deleted'; END IF;
  SELECT role INTO previous_role FROM public.admin_roles WHERE user_id=u.id;
  UPDATE public.users SET is_admin=true WHERE id=u.id;
  INSERT INTO public.admin_roles(user_id,role,granted_by) VALUES(u.id,'owner',NULL)
    ON CONFLICT(user_id) DO UPDATE SET role='owner',granted_by=NULL,created_at=now();
  INSERT INTO public.admin_change_log(actor_user_id,actor_email,area,action,subject,"before","after",reason)
    VALUES(u.id,u.email,'role','break_glass_restore',u.id::text,
      jsonb_build_object('role',previous_role,'is_admin',u.is_admin),
      jsonb_build_object('role','owner','is_admin',true),
      'Authorized database operator restored an owner after verifying account identity');
END $$;
COMMIT;
```

On any error, ROLLBACK and investigate. Then sign in as the recovered owner, perform MFA, and verify role administration. Record the executing database operator in the incident record; the application audit actor above identifies the recovered account, not the database operator. This runbook was documented, not executed against production.
