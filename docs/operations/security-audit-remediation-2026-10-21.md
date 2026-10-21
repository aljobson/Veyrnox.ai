# Seven-finding security remediation: 2026-10-21

## Scope and safety

Owner-authorized implementation, review, release and non-billable retest of A01–A07 from the read-only security audit. Publishing remains draft-only. No generation, provider submission, checkout, public delivery, real webhook mutation, account grant or feature activation is authorized by these regression tests. This is an AI-assisted independent source/fixture audit, not a certified third-party penetration test.

Baseline: `2de6ef49b2a4e0dd1d3d132d668c6e6cb3fbdf04`. Recovery branch: `codex/security-audit-seven-recovery`. The primary checkout and unrelated worktrees are preserved. Durable checkpoints are committed and pushed as each reviewed group passes. No secret values or authenticated browser state belong in this record.

## Findings and evidence

| Finding | Fix | Evidence / remaining release check |
|---|---|---|
| A01 login CSRF | Reject/scrub implicit fragments; signup S256 PKCE | Genuine RED, focused auth and actual callback-effect regressions GREEN; independent review. Real email/OAuth/MFA acceptance is not established by offline tests. |
| A02 capability telemetry | Shared canonical path redaction; nested fields, Date preservation, proxy Referer blanking and replay exclusions | Genuine RED; 11-locale, encoded, separator/dot-path, PostHog/Sentry immutable payload and actual proxy-overlay tests GREEN; independent review. Historical event exposure/retention unverified. |
| A03 completion race | Authoritative scoped state; terminal-only processed no-ops; recover unfinished copies/refunds | Genuine RED; 51 offline cases GREEN; 100% scoped lines, 97.30% branches; independent review. No real provider callback submitted. |
| A04 TikTok duplicate drafts | Exact-claim mark before initiation; poll saved IDs | Genuine RED; 69 offline sweep/continuation/hold/video/photo cases GREEN; independent review. No TikTok inbox or public post created. |
| A05 refund-before-purchase | Private append-only tombstone, consistent order/user locks; retry missing orders | Genuine route and PostgreSQL RED; PostgreSQL GREEN/replay and protected production migration are release gates, recorded below when completed. |
| A06 inaccessible consent settings | Persistent choices, safe blocked-storage handling | Genuine RED; real component/hook regressions GREEN; independent review. Desktop/mobile real-browser journeys are an additional release check. |
| A07 Sentry disclosure | Necessary error reporting in 11 privacy notices | 93 legal contract/source/hash/render tests GREEN; independent review. Human translation/legal/vendor-configuration verification is not claimed. |

## Release gates and status

Recovery is in progress; this document must not be read as a production-live claim. Update this section with exact PR, reviewed head, merge/deployed SHA, migration workflow and smoke results as they become available.

Recovery PR: [#1470](https://github.com/aljobson/Veyrnox.ai/pull/1470). At intermediate head `145771a5d0c53147edb3abb724a3c2d8f4ed6e42`, CI passed 5,188 unit tests (one skip), 452 database acceptance tests (one skip), all 335 migrations replayed, Worker smoke and security checks. Its six new consent journeys passed on desktop/mobile, but the complete browser matrix did not pass: existing fixtures blocked previously unmapped synthetic SDK startup requests, and the two telemetry transport cases were suppressed by SDK bot detection. These are not claimed as final-head acceptance. Repairs retain the full unfiltered matrix, locally fulfill exact synthetic SDK paths, and model an interactive navigator only in the exact-loopback privacy fixture. Production bot filtering is unchanged. The full final-head matrix remains required.

- Required before merge: full unit/lint/type/security gates, real PostgreSQL acceptance/replay, Worker CI smoke, independent review and isolated browser privacy journeys.
- Required for A05 live: owner-approved `apply-migrations` run for 0358. Never apply directly using a local production credential.
- Required after deploy: visible production revision and non-billable route/header/auth-boundary/privacy-document retest. If another release supersedes this one, verify the live revision contains the fix commit instead of describing mixed results as exact-SHA evidence.
- Prohibited: paid retries, real generation, public posting or actual scheduling/delivery tests. Keep store billing and unrelated gated features unchanged.

## Residual limitations

Previously dropped store refunds and historical capability telemetry require a separately scoped operational investigation; this release does not prove whether exposure/loss occurred. Credit-pack ordering is not store Publish subscription ordering. Missing-subscription retries improve eventual delivery but do not replace durable subscription terminal-event ordering, which remains unresolved behind the disabled store-billing gate. Browser fixtures do not prove production admin interiors, provider delivery, email deliverability or MFA. No certification or blanket claim that every feature is secure is made.

For the money-spine decisions and rollback constraints, see [ADR-0241](../adr/0241-security-audit-remediation.md).
