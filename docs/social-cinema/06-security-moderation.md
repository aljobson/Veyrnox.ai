# 6. Security, Trust & Moderation

## 6.1 Security objectives

Protect:
- user accounts
- creator content
- voting integrity
- moderation tools
- provider credentials
- personal data
- platform reputation

## 6.2 Authentication

Supabase Auth is proposed for identity. It uses JWT-based authentication and integrates with database RLS.

MVP controls:
- email verification
- secure password requirements where passwords are used
- session expiry/refresh handling
- server-side role checks
- optional MFA for administrators
- account lock/rate-limit controls
- bot prevention controls on high-risk flows

## 6.3 Authorization

RLS is mandatory on all exposed application tables.

Principles:
- deny by default
- least privilege
- ownership checks
- separation of user, creator, moderator and administrator capabilities
- privileged service role never shipped in mobile/web client

## 6.4 Secret management

Secrets include:
- Supabase service role
- Cloudflare API token
- notification credentials
- analytics write keys where privileged
- webhook secrets

Requirements:
- environment-specific
- encrypted at rest
- rotated
- never committed to source control
- never logged
- production access restricted

## 6.5 Voting integrity controls

- database unique constraints
- server-side competition validation
- rate limiting
- risk scoring
- event correlation
- moderation review
- immutable/raw event retention for a defined period

## 6.6 Content trust & safety

Users shall be able to report:
- sexual content
- violent content
- hate/harassment
- illegal activity
- impersonation
- copyright concern
- spam/scam
- other policy violation

The production service requires published Community Guidelines and Terms of Use.

## 6.7 Moderation states

Content:
- Draft
- Published
- Limited
- Hidden
- Removed
- Under Review

Accounts:
- Active
- Restricted
- Suspended
- Banned

## 6.8 Moderation controls

Moderator actions must:
- record actor
- record timestamp
- record target
- record reason
- record previous/new state
- support escalation
- preserve an audit trail

## 6.9 Admin security

Admin/moderator console should require:
- dedicated role
- MFA
- short sessions or step-up for destructive actions
- audit logging
- restricted production access
- no shared accounts

## 6.10 API protection

- TLS only
- schema validation
- rate limits
- input length limits
- safe error messages
- idempotency on duplicate-sensitive operations
- webhook signature verification
- CORS restrictions for web administration surface
- dependency vulnerability scanning

## 6.11 Privacy by design

- collect minimum necessary personal data
- do not expose email addresses publicly
- separate public profile from authentication identity
- minimise fraud/device identifiers
- document analytics SDK collection
- support data subject/account deletion workflows
- define retention periods before production launch

## 6.12 Secure development lifecycle

Before production:
- threat model
- architecture security review
- SAST
- dependency/SCA scanning
- secret scanning
- mobile security testing
- API penetration testing
- RLS policy tests
- abuse-case testing
- incident response runbook
