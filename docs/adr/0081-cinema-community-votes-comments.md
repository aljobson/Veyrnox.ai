# ADR-0081 — Cinema competition voting and pre-approved comments

Status: implementation under the owner’s 10 October 2026 instruction to build remaining features. The owner explicitly selected moderator approval before comments publish. Activation remains pending acceptance and operational release gates. Engineering limits below are initial implementation choices, not commercial or legal policy approvals.

## Decision

Migrations 0266 and 0267 add free community ballots, comments and reports. A ballot targets one published Film, Short, Trailer, Series or Episode in an open competition. All ancestors and the creator must remain eligible. A current Auth account, active Cinema membership and opt-in profile are required to write. One ballot per voter/title/competition is enforced by a unique constraint; independent retry keys cannot create a second vote. An actor/key pair cannot address a different request. No Credits, payments, rankings, awards, prizes or winners are generated.

The initial qualifier means a current active, unfrozen profile voting within the competition’s server-enforced window, with no outstanding velocity hold. It does not attest that the viewer watched the film or is a unique human. Ten new votes per minute count; subsequent ballots are held. Sixty new ballots per hour is the hard ceiling. Counts exclude held/rejected ballots and currently ineligible voters. The deadline is checked with the actual clock after waiting for locks. Sybil detection, watch thresholds, ranking normalization and winner/tie rules remain separate work.

Cinema administrators create and close competitions and decide held votes. A competition lasts at most 31 days and applies to selected content types; it does not curate a custom title list. At most 25 unfinished competition windows are allowed. Voters and title owners cannot review their own ballots. Privileged requests require a verified person’s Cloudflare Access login, current administrator role and fresh verified TOTP, rechecked after contended database locks. Decisions include a reason, request ID and replay-safe append-only audit; updating, deleting or truncating that audit is denied.

Comments are plain text, at most 2,000 characters, and always begin **pending**. Public reads project approved comments only. An author can see their own non-public comments and withdraw them, including after a title is hidden. Administrators approve or reject pending comments, or remove approved ones, with the same Access/MFA/current-role and self-review controls. No approval can revive a withdrawn, rejected or removed comment. Author or content ineligibility hides approved comments immediately on public reads.

Initial comment limits are one new comment per minute, twenty per rolling 24 hours, and five pending comments across titles. Reporting needs an active profile, a known category and a bounded reason. At most one report per reporter/comment and twenty reports per rolling day are allowed. Reporting one’s own comment is denied. Resolving a report does not implicitly remove its comment: these are separate audited decisions. Oldest-first review queues show 50 comments/reports and 100 held votes at a time; refresh after decisions loads the next batch. Public comments use 25-row cursor pagination.

## Boundaries and release

All tables have forced RLS and no direct browser or service table grants. Empty-search-path security-definer RPCs are service-only. Public handlers explicitly ignore inbound identity headers and return no voter identity, risk reason, pending comment, report or billing data. Private/admin handlers consume the account quota and return no-store responses. Payloads are exact allowlists; logs contain generated request IDs and fixed result codes, not comment/report bodies or credentials.

`VOTING_ENABLED=false` and `COMMENTS_ENABLED=false` are explicit in both environments. Viewing, profiles and the Cinema master gate also apply. Stage exact migration source, reconcile receipts, pass CI and obtain the protected production-database environment approval under ADR-0023 before production DDL. Keep activation off through the relevant clean observation window and real signed-in/Access acceptance. Name moderation coverage, incident escalation, report-response expectations and privacy/retention ownership before activation. Vote abuse thresholds require monitoring and adjustment, not a claim of fraud prevention.

Comment bodies and report details are retained in private tables; submission payloads also support replay. Withdrawal removes public visibility, not historical data. Accepted privacy/retention and deletion requirements must cover these records, immutable decisions and backups before activation. No compliance or complete security-audit claim is made.

## Evidence

`scripts/test-cinema-voting.mjs` and `scripts/test-cinema-comments.mjs` run actual disposable PostgreSQL. They exercise windows, duplicate and concurrent retries, velocity holds, decisions, current Auth/role checks, parent privacy, pre-approval, reports/removal, withdrawal, ACLs and immutable audits. Default-privilege and FK-index checks cover the new schema. API tests cover input and public projection boundaries. The administrator route suite uses actual signed Access fixtures and rejects service tokens.

Reticle produced `verified: yes` at net grade for a vote/count surviving reload, a private pending comment surviving reload, and an explicit moderator approval leaving the queue. Browser identities and API responses were synthetic local fixtures; these are not real staging account, Access or content-provider acceptance. Local flow artifacts remain in the managed worktree’s `.reticle/flows/veyrnox-ai-24d31e20/`.

Staging applied the exact SQL as receipts `20261010191012` (0266, 19,178 bytes, MD5 `09ad011f0fdbd0722869085684e6362a`) and `20261010191028` (0267, 17,102 bytes, MD5 `154767fee7696c6a3c352f2fa59386ad`). All six tables have forced RLS and revoked direct grants; all eleven functions have empty search paths and service-only execution. The seven reconciliation counts and recovery indicators were zero after application. Production application and live activation remain pending.

The full CI append-only check found that 0266 blocked TRUNCATE with a generic diagnostic rather than the shared operation-specific one. Forward migration 0268 installs the existing shared TRUNCATE guard; the rejection and all earlier assertions remain enforced. Applied staging files 0266/0267 are preserved byte for byte.
