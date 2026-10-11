# Private Cinema collections — release verification, 11 October 2026

Branch: `codex/cinema-retention`. Migration: `0283_cinema_saved_titles_and_follows`. Both runtime flags remain false.

## Local release evidence

- Production build, security/client boundaries, typecheck, migration numbering and lint pass (zero errors; 99 existing warnings).
- Full suite: 3,030 passing tests, one existing skip. The final logging-only adjustment also passed targeted API/feature tests.
- PostgreSQL 17 rebuild: all 263 migrations and all 62 workflow SQL regression scripts pass. The new migration replays twice and exercises caller isolation, hidden content, exact idempotency, concurrent retries, collection/rate caps, RLS/ACL and unchanged credits.
- Positive Reticle verdicts (`verified: yes`, durable): save and reload; creator and series follow and reload; exact saved/creator/series list entries; title navigation; an independent synthetic account sees an empty collection; withdrawing the series hides the saved entry; a fresh signed-out visitor sees the sign-in guard and no private title.

Reticle ran against the real local Postgres RPCs and real middleware with synthetic signed identities and local Auth plumbing. This proves local app behavior, not hosted independent-account or identity-provider acceptance. Initial cold-navigation, occlusion, wrong-label and incomplete network-body predicates were retained as failed evidence; the corresponding final assertions passed after reading the actual UI and exact response. The local provider sign-out endpoint was unavailable: account state and private data cleared, but provider revocation was not verified locally. No assertion was removed to produce a pass. Temporary SDK/Auth/CSP wiring was removed, and owned app/adapter servers stopped before the final build.

Evidence JSON and screenshot are saved in the chat's owner packet. Hosted acceptance still requires viewer save/remove/reload, creator/series follow/unfollow, two separately authenticated people, account switching during delayed responses, current withdrawal and mobile navigation. Independent administrator/MFA checks remain separate gates for moderation and rankings. No public post, notification, upload, credit grant or generation was triggered.
