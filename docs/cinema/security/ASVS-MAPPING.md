# Cinema ASVS mapping

Baseline: [OWASP ASVS v5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0/5.0), IDs verified against its versioned English JSON. ASVS is published under CC BY-SA 4.0 by OWASP; descriptions here are concise implementation topics, not a reproduction of the standard. Consult the linked standard for normative requirements. Target L2 includes applicable L1 and L2 controls; selected L3 controls apply to sensitive paths.

This is an **initial scoped mapping**, not a complete ASVS audit or compliance claim. Applicable requirements outside the rows below remain UNASSESSED, never implicitly satisfied. PARTIAL means relevant source/test evidence exists but the full requirement or complete Cinema scope has not been verified. OPEN means work/evidence is missing. DOCUMENTED means design only. No row is a certification or a passing manual test.

Paths are relative to repository root; ASVS topics below summarize rather than quote requirements. API IDs refer to OWASP API Top 10 2023. SSDF IDs refer to SP 800-218 v1.1 practices (design PW.1/PW.2, review PW.7, executable tests PW.8, criteria PO.4, source protection PS.1, root-cause response RV.3).

| ASVS requirement / topic | Applicable? | Implementation / evidence | Test or required verification | Status | API / SSDF / gap |
| --- | --- | --- | --- | --- | --- |
| v5.0.0-1.2.4 / parameterized data access | Yes | Static SQL functions in migration 0132; arguments through RPC client | `scripts/test-social-cinema-foundation.mjs`; future query-injection tests | PARTIAL | API1/3; PW.5/PW.8; G04 |
| v5.0.0-2.2.1 / input constraints | Yes | Profile strict allowlist, size limits and DB checks | `tests/socialCinemaProfile.test.mjs` malformed/unknown/oversized cases; inventory all future inputs | PARTIAL | API3/4; PW.8; G04 |
| v5.0.0-4.1.1 / response media type | Yes | Profile `Response.json`, middleware JSON errors | Inspect deployed headers for each inventoried route | PARTIAL | API8; PW.8; G04 |
| v5.0.0-8.1.1 / function and object policy | Yes | `SECURITY-ARCHITECTURE.md` role/ownership policy, ADR-0048 | Review each permission and object action before implementation | DOCUMENTED | API1/5; PW.1; G02 |
| v5.0.0-8.1.2 / field access policy | Yes | Profile allowlist/public projection, private membership | Profile privacy and injection tests; future financial/creator fields | PARTIAL | API3; PW.1/PW.8; G02/G10 |
| v5.0.0-8.2.1 / function permissions | Yes | Auth middleware, service-only RPC grants | Viewer→creator, moderator→finance, normal user→admin tests required | PARTIAL | API5; PW.8; G02 |
| v5.0.0-8.2.2 / object permissions | Yes | Verified subject only on own-profile RPC; no client grants | Foundation two-user isolation; future two-creator list/detail/write tests | PARTIAL | API1; PW.8; G02 |
| v5.0.0-8.2.3 / field permissions | Yes | Ownership/role/status fields rejected on create | Profile injection cases and response-projection assertions | PARTIAL | API3; PW.8; G02 |
| v5.0.0-8.3.1 / trusted enforcement | Yes | Middleware overwrites identity; DB/RPC boundary | Existing JWT/header tests and RLS acceptance; future route bypass tests | PARTIAL | API5; PW.7/PW.8; G01/G02 |
| v5.0.0-8.3.2 / prompt permission changes (L3) | Sensitive actions | Cinema revocation/status checks incomplete | Revoke role/ban during active session and queued job; prove immediate denial | OPEN | API1/5; PW.1/PW.8; G01/G02 |
| v5.0.0-9.1.1 / token integrity | Yes | `lib/supabaseJwt.js`, middleware | `tests/supabaseJwt.test.mjs`: tampered payload/different signing key | PARTIAL | API2; PW.8; G13 |
| v5.0.0-9.1.2 / algorithm restriction | Yes | ES256 allowlist | JWT tests reject HS256/malformed; verify all accepted token families | PARTIAL | API2; PW.8; G13 |
| v5.0.0-9.1.3 / trusted key source | Yes | Configured Supabase JWKS and rotation cache | JWT tests cover key rotation/unknown kid/outage; inspect untrusted header handling | PARTIAL | API2/7; PW.8; G13 |
| v5.0.0-9.2.1 / token time validity | Yes | Expiry checked; complete time-policy assessment pending | Expired token exists; explicitly assess not-before and skew cases | PARTIAL | API2; PW.8; G13 |
| v5.0.0-9.2.2 / token purpose | Yes | Current audience/role validation is not full proof of purpose | Test ID/other-purpose token rejection with valid signatures | OPEN | API2; PW.8; G13 |
| v5.0.0-9.2.3 / audience restriction | Yes | `validateClaims` expects authenticated audience | Wrong-audience test in JWT suite; provider integration verification | PARTIAL | API2; PW.8; G08/G13 |
| v5.0.0-16.2.1 / event metadata | Yes | Selected console events; no complete request correlation | Assert generated request ID, actor/resource/result and safe timestamps | OPEN | API8; PW.1/PW.8; G09 |
| v5.0.0-16.2.5 / sensitive log protection | Yes | CI secret-variable logging grep; narrow auth messages | Synthetic credential/log-redaction fixtures; inspect provider error paths | PARTIAL | API8; PW.7/PW.8; G05/G09 |
| v5.0.0-16.3.1 / authentication events | Yes | Auth rejection logger; full provider success/failure coverage not verified | `tests/authRejectLog.test.mjs`; live event inventory and alert drill | PARTIAL | API2; PW.8; G08/G09 |
| v5.0.0-16.3.2 / authorization events | Yes; stronger for sensitive access | Comprehensive Cinema denial/privileged decision log missing | Test allow/deny audit for high-value actions without sensitive payloads | OPEN | API1/5; PW.8; G09 |
| v5.0.0-16.3.3 / security event inventory | Yes | Required inventory in architecture/test plan | Test validation/rate/automation decisions and attempted bypass logs | OPEN | API4/6; PW.1/PW.8; G09 |

## Remaining coverage

V1 encoding, V2 business logic, V3 frontend, V4 API, V5 files, V6 authentication, V7 sessions, V8 authorization, V9 tokens, V10 OAuth/OIDC, V11 cryptography, V12 transport, V13 configuration, V14 data, V15 architecture and V16 logging all need full applicability and evidence review as relevant features are implemented. V17 WebRTC is presently not applicable because Cinema v1 has no WebRTC implementation; revisit if live rooms introduce it. Individual unused technologies within other chapters need explicit N/A rationale, not a blanket exclusion.

For every selected requirement, record exact version/ID, applicability reason, implementation path/commit, automated run and manual evidence, result/date and reviewer. Identify additional L3 requirements for recovery, privilege administration, payments and payouts before coding those flows. Map each new API to API1–API10 threats; mark tests NOT IMPLEMENTED until real evidence exists. Critical/high gaps block their release as specified in the gap assessment.

SSDF process evidence remains partial: CI/review workflows support PO.4, PS.1 and PW.7/PW.8; actual branch protection, reviewer settings, scanners and artifact integrity must be verified. Incident notes define RV.3 expectations but no response exercise has been conducted. Do not confuse a documented process with an operational one.

## Creator increment evidence (ADR-0049)

For v5.0.0-2.2.1, 8.2.1, 8.2.2, 8.2.3 and 8.3.1, migration 0133 and `lib/cinema/creatorApi.js` add strict fields, active scoped roles, self-review denial and trusted ownership enforcement. The creator API/database tests cover forbidden actors, replay and concurrent decisions. For 8.3.2, current membership is rechecked under lock for approvals; no role/status claim is trusted from clients. For 16.2.1/16.3.2, creator request IDs/redacted allow/deny events and immutable decision records add evidence. These entries remain PARTIAL: broader Cinema coverage, authenticated deployment verification, log retention/alerts and full ASVS assessment are outstanding. Fresh MFA is implemented using verified TOTP event time (ADR-0049); it is not inferred from JWT refresh time.
