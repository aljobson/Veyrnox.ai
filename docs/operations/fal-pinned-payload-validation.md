# Pinned fal payload validation

Migration 0243 adds a byte-length check after image-size pinning and before paid debit or free allowance admission. The incoming payload can fit the 16,384-byte limit while its stored representation exceeds it. The earlier behavior reached the outbox CHECK after financial work, rolled the RPC back, and surfaced as an uncertain-admission 503. The new behavior returns `INVALID_INPUTS` before those effects; the existing admission helper maps this to 400 `invalid_inputs` and publishes no queue message.

The forward migration replaces only `admit_fal_dispatch` and preserves its replay, policy, capacity, private-helper and grant contracts. Applied migration files are unchanged. Existing canonical replay stays before fresh validation. Valid payloads with exactly 16,384 stored JSONB bytes still admit and replay once.

Local PostgreSQL validation passed a fresh 229-migration rebuild, 17 capacity cases and 11 reserved-only cases against the new function. Eight new cases cover ASCII and UTF-8 byte overflow, paid/free 400 responses through the admission helper with real PostgreSQL, exact-boundary paid/free acceptance, idempotent replay and changed-input conflict. The new suite also reapplies the migration twice, checks capacity policy preservation, and verifies service-role/anonymous/authenticated execution grants. CI runs it after the existing reserved-only suite; older suites reapply 0243 after their historical setup migrations so they exercise the current function.

These tests use a disposable localhost database and roll back fixtures. No staging/production migration or deployment was performed. Apply through the protected migration workflow after review, then validate the same boundary on staging. The older rollback-only probe intentionally expects the pre-0243 outbox constraint error and is historical evidence; do not use it as the post-0243 acceptance assertion.

Reticle verification was skipped: the migration is not applied to a running application. Database and admission-helper behavior were verified directly against PostgreSQL.
