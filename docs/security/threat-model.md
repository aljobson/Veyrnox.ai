# Threat model

Trust boundaries: browser → API; API → Supabase; API → providers; callbacks → API; remote media → R2/renderer; deployment → production. Private projects/prompts are confidential; voice/verification data sensitive; service credentials restricted. Public assets exist only through a distinct publication action.

| Threat / actor | Required mitigation | Evidence / remaining gap |
| --- | --- | --- |
| Malicious registered user changes project or asset IDs | Verified identity + live membership + RLS + indistinguishable not-found | Tenant RLS and API tests; existing `get_user_asset` gate retained |
| Compromised account raises its role or transfers ownership | No membership writes from browser; column grants; AAL2 for sensitive actions | Project write permissions tested; ownership-transfer UI/API not enabled |
| Cross-environment identity/key confusion | Issuer-scoped JWKS, finite cache, validated URLs, isolated deployment config | Auth/config regression tests; actual credentials require operator provisioning |
| Bot farm / financial abuse | Atomic rate-limit/debit lock, idempotency key bound to request, quotas | Existing ledger retained; spend/concurrency budgets remain backlog |
| Compromised provider or malicious callback | Signature, expected provider tenant, bounded body, replay-safe state | Existing signature/retry tests; moderation/media inspection pending |
| Hostile uploads/media | Quarantine, parser isolation, bounded fetch, MIME/magic bytes | Existing upload inspection/consent retained; dedicated quarantine and generated-output moderation remain |
| Leaked provider/service key | Backend-only imports, log allowlist, rotation, environment isolation | CI boundary scan and sanitized logs; operator must rotate real credentials |
| Prompt injection / malicious AI output | Schema + authorization on every tool; no arbitrary code/SQL | No new AI tools or voice cloning enabled in this phase |
| Insider/admin abuse | Append-only audit, AAL2, least privilege, reviewed deployment | Transactional project audit; legacy admin/retention audit coverage incomplete |
| Supply chain compromise | Lockfile, dependency audit, lint/typecheck, test/build gates | CI gates; external secret/SAST scanners remain deployment backlog |
| Fraudulent creator / payout abuse | Separate immutable creator ledger, moderated publication, fraud review | No payout/publication feature enabled |
| Database failure during mutation | Atomic business change + audit + idempotency; deny on policy failure | PostgreSQL transaction tests; backup/restore drill pending |

Residual risks: bearer tokens stored in localStorage; offline JWT validation does not immediately observe revoked sessions; CSP inline allowance remains for existing hydration; privileged legacy ledger RPCs require API ownership discipline; no production claim of complete media moderation, quarantine or multitenant generation until later phases are complete.
