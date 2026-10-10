# ADR-0084 — Cinema episode story polls

Status: implementation under the owner's 10 October 2026 instruction to build remaining roadmap features. Initial engineering limits below do not constitute approval of commercial, privacy or retention policies. Ships off pending release acceptance.

## Decision

Migration 0270 adds a moderator-curated question to an eligible published Episode. Questions have two to six distinct plain-text answers (120 characters each), at most 240 characters of question text, and a window of at most 31 days. Only one open-status poll may overlap another on the same episode. A global cap of 100 unfinished windows bounds inventory. Questions and answers are immutable after publication; moderators can close a window. Creator-submitted poll drafts are future work.

An active, unfrozen Cinema profile with a current Auth account can record one immutable answer per poll, free of charge. A retry returns its canonical choice; a different answer explicitly conflicts. Retry keys cannot address another request. No Credits, payments, watched-duration qualification, competition rankings or awards are generated. Story choices are independent of competition ballots in ADR-0081.

Ten new choices per minute count; subsequent choices are held for review, with a hard ceiling of sixty new choices per rolling hour. Aggregates count only qualified choices from currently eligible voters. Held, rejected, deleted-Auth and frozen/suspended accounts are excluded. These limits do not attest that an account is a unique person. Windows use the actual clock after contended locks. Closing a poll serializes against new choices; an unchanged canonical retry remains available after closure.

Cinema administrators publish/close polls and review held choices. Each request requires a verified person's Cloudflare Access login, current administrator membership and fresh verified TOTP. Authority is checked again after locks, including the shared community audit idempotency lock. Administrators cannot review their own choice or episode. Decisions append an immutable community audit with a reason and request ID; update, delete and truncate remain denied. Queues show the latest 50 polls and oldest 100 held choices; resolving choices and refreshing advances that queue.

## Boundaries and release

Three new tables have forced RLS and no direct grants, including to the service role. Four empty-search-path security-definer RPCs have service-only execution. API inputs use exact allowlists and bounded bodies; private/admin requests consume the account quota. Public responses contain questions, answer counts and window state, and explicitly omit voter identity, risk details and owned choices. Only the authenticated route returns the requesting account's choice. Future questions are not exposed before opening. Reads require published, eligible content and all eligible ancestors.

`STORY_POLLS_ENABLED=false` is explicit in staging and production. The Cinema, viewing and profile gates also apply, independently of the competition voting flag. Stage exact source and reconcile migration receipts; production DDL uses the owner-reviewed workflow in ADR-0023. Keep activation off until the relevant clean observation window and real-account/Access acceptance, with moderation coverage and incident escalation ready. Privacy/retention acceptance must cover owned answers and immutable decision history before activation. No application, provider agreement or legal policy is approved by this implementation.

## Evidence

A fresh disposable PostgreSQL replay applied all 250 migration files, followed by all 57 database acceptance scripts. The new story-poll script verifies replay, duplicate/concurrent answers, option isolation, Auth deletion/frozen/suspended voters, content/ancestor visibility, future question privacy, velocity holds, administrator self-review refusal, overlap/cap limits, clock deadlines and MFA expiration after contended locks, forced RLS, table/function privileges and unchanged financial ledgers. The signed Access administrator suite covers the actual new GET/POST routes and rejects service tokens and invalid assertions.

Reticle produced `verified: yes` at net grade for five local browser journeys: a counted choice surviving reload, an unconfirmed request retaining zero votes, resolving a held choice, closing a window, and publishing the intended question/options/dates with reload persistence. The action windows reported no console errors or disagreeing channels. API identities and responses were synthetic local fixtures; these are screen checks, not real staging Auth, MFA, Access or provider acceptance. The local authenticator panel could not load its synthetic account settings and was not claimed as verified. Partial instrumentation observed network, DOM and storage but no registered application store. The fixture bootstrap was removed before the production build. Saved flows remain local in `.reticle/flows/veyrnox-ai-24d31e20/`; replay requires the matching fixture state and is not an unaided production gate.

Unit tests, lint, security type-check and production build results are recorded in the release pull request. Permanent staging/production application and live activation require separately recorded receipts and acceptance.
