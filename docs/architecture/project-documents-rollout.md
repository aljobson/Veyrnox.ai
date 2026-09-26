# Project documents: staging acceptance

Migration `0140_project_documents` was applied only to AI staging `yrqzwqywxfesmbvhzjgj`. No changes were made to production or either unrelated wallet database. The UI builds on PRs #334 and #335 and remains under the existing Projects preview gate.

## Local verification

- Full replay: all 133 repository migrations applied to a fresh local PostgreSQL. Reapplying 0140 also passed.
- Nine document integration checks: atomic history/audit and idempotency, canonical schema and direct-write denial, tenant/viewer isolation, stale edits and append-only restore, live revocation, concurrent writers, rate limiting, project deletion, and historical attribution after Auth deletion.
- All 14 existing tenant integration checks passed.
- Unit/API: 675 tests, 674 pass and one existing skip. Lint: zero errors and seven existing warnings. Strict security typecheck and client boundary checks passed; staging Next/OpenNext build and deployment passed.
- UI uses existing AppNav, Button, Modal and design tokens. 21st catalog search covered autosave and revision history; no dependency was added. Automated UI review reported no findings.

## Security advisors

No finding referenced the new document table or RPC. Existing notices remained for deliberate service-only tables without client policies, three anonymous health/catalog/ledger-report functions, and disabled leaked-password protection. Their guidance is available in [RLS policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anonymous definer function notices](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). These settings were not changed by this feature.

## Live acceptance

Deployed staging Worker `f0de7ecc-660e-4c58-b278-91ce4ec344c7`. The signed-in browser created fixture `8239327c-bf3c-4598-ac15-9b8b9502c283` and verified:

- Typing a brief autosaved revision 1; reloading preserved both content and revision.
- Changing brief, aspect ratio and frame rate saved revision 2.
- Previewing and restoring revision 1 produced revision 3, retained revision 2, and restored the original canvas and brief.
- An independent request wrote revision 4. The stale UI save was refused; review displayed the server version while retaining the draft. Explicitly choosing the draft produced revision 5.
- The audit trail contained four PROJECT_DOCUMENT_SAVED and one PROJECT_DOCUMENT_RESTORED events. No autosave loop occurred after JSONB reordered fields.
- Desktop and 360 px phone layouts were inspected; document width stayed at 360 px on the phone. The viewport override was reset.
- The fixture was soft-deleted through the UI. Authenticated document and history reads then both returned 404. Immutable snapshots remain for history/audit retention; there is no active test project.

Catalog checks confirmed RLS ENABLE/FORCE, no authenticated INSERT grant and no anonymous RPC execution grant for the new schema. Production and unrelated database targets were not used.
