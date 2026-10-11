# ADR-0086 — Manual credit grant safeguards

Status: implemented; manual grants remain off pending real administrator acceptance and an explicit owner enablement decision.

The new admin console allowed a frozen administrator to issue a grant and accepted a replay with a changed reason. These were reproduced in the disposable local database. The existing global unique audit key protects against duplicate financial writes; cross-recipient races could still throw instead of returning a typed conflict.

Migration 0278 adds a stable actor UUID on new grant audit rows and a service-only guarded RPC. It requires a current Auth record, an unfrozen administrator and MFA proved within five minutes, including after contended locks. Global key serialization and ordered account balance locks bind replay to actor, recipient, amount, action and the complete trimmed reason. A conflicting or legacy unbound key is refused. The old grant signature loses service-role execution. Grants still use the established ledger_grant money spine; no balance is edited directly.

ADMIN_CREDIT_GRANTS_ENABLED is false in production and staging, independently of ADMIN_REQUIRE_AAL2. The existing UI and ledger reads remain available. Activation needs real person Access/fresh MFA acceptance and an explicit owner decision to enable manual grants. Numeric grant caps and a second-person approval threshold are optional policy choices; if selected, they require separately implemented and reviewed controls. The owner deferred that decision on 11 October 2026. Keeping manual grants off does not block unrelated features. This change issues no production credits.

Actual PostgreSQL tests cover current role/Auth, frozen/deleted administrators, MFA expiry, full replay binding, cross-recipient contention and ACLs. API tests retain the person Access and verified identity checks and prove the new rollout/freshness gates. Browser acceptance of a real administrator grant remains outstanding; no UI was changed or claimed verified by this backend fix.
