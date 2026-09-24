# 8. MVP Delivery Roadmap

## Phase 0 — Foundation

Deliverables:
- repositories
- environments
- design system
- authentication
- baseline database schema
- RLS policies
- CI/CD
- telemetry
- admin role model

Exit criteria:
- user can register/sign in
- environment separation working
- migrations and policy tests automated

## Phase 1 — Watch

Deliverables:
- creator/series/episode models
- video upload session
- media processing status
- vertical player
- For You feed
- series pages
- watch progress events

Exit criteria:
- creator can publish an episode
- user can discover and watch it reliably

## Phase 2 — Vote

Deliverables:
- competitions
- qualified votes
- story polls
- Vote tab
- anti-duplicate controls
- initial risk scoring

Exit criteria:
- one qualified user vote per target/competition
- poll results function correctly
- anomalous activity can be held/rejected

## Phase 3 — Rank & Win

Deliverables:
- ranking aggregation
- score normalisation
- leaderboard
- Winners tab
- moderator approval
- featured content

Exit criteria:
- weekly competition can close, score, review and publish winners

## Phase 4 — Social & Retention

Deliverables:
- follows
- shares
- saved content
- notifications
- creator analytics
- return-user prompts

Exit criteria:
- followed creator/series release can trigger opt-in notification
- creator sees basic performance dashboard

## Phase 5 — Trust & Launch

Deliverables:
- report flow
- moderation queue
- admin audit logs
- abuse dashboards
- performance testing
- security testing
- app-store release configuration

Exit criteria:
- launch checklist approved
- critical/high security findings resolved
- incident and moderation runbooks validated

## MVP acceptance criteria

1. User can sign up and authenticate.
2. Creator can create a series and upload an episode.
3. Episode can be processed and published.
4. Viewer can consume content in a vertical feed.
5. Watch completion is captured.
6. Viewer can cast one qualified vote.
7. Story poll supports one choice per account.
8. Weekly ranking calculates deterministically.
9. Moderator can approve/publish winners.
10. User can follow a creator or series.
11. User can report content.
12. Moderator can hide/remove content.
13. Admin actions are audited.
14. Mobile crash/error telemetry is available.
15. Production secrets are not embedded in the client.

## Post-MVP backlog

- creator monetisation
- premium episodes
- subscriptions
- revenue sharing
- advanced recommendations
- AI-assisted creator tools
- richer comments/community features
- web viewing experience
- TV apps
- live premieres
- collaborative creators
- advanced rights management
