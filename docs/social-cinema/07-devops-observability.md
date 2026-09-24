# 7. DevOps, Observability & Operations

## 7.1 Source control

Recommended repository structure:

```text
/apps/mobile
/apps/admin
/packages/ui
/packages/types
/packages/config
/supabase/migrations
/supabase/functions
/docs
```

Branch protections:
- pull request required
- automated tests required
- secret scanning
- dependency scanning
- protected production branch

## 7.2 CI/CD

### Mobile
Expo EAS Build for reproducible iOS/Android builds and EAS Submit for store submission.

Pipeline:
1. lint
2. type check
3. unit tests
4. dependency/security checks
5. build
6. internal distribution
7. release approval
8. store submission

### Backend
- migration validation
- RLS tests
- function tests
- deploy to staging
- smoke tests
- production approval

## 7.3 Observability

Collect:
- API latency/error rates
- authentication failures
- upload failures
- media processing delays
- playback errors
- vote rejection/hold rates
- moderation queue age
- push notification failures
- app crashes
- release versions

## 7.4 Product analytics

Core funnel:

`App open → Feed view → Episode start → 50% watch → Complete → Vote → Follow → Return`

Key metrics:
- DAU / WAU / MAU
- D1 / D7 / D30 retention
- average sessions per user
- episode completion
- votes per eligible viewer
- creators publishing weekly
- series continuation rate
- share conversion
- notification opt-in
- report rate

## 7.5 Alerts

Examples:
- authentication error spike
- feed API p95 threshold breached
- elevated app crash rate
- upload processing backlog
- webhook failures
- abnormal vote velocity
- moderation queue SLA breach
- third-party service degradation

## 7.6 Backups and recovery

- automated Postgres backups
- tested restore procedure
- migration rollback plan
- provider configuration documented
- infrastructure secrets recoverable through controlled process
- winner/ranking snapshots preserved

## 7.7 Operational runbooks

Required:
- media upload incident
- playback outage
- authentication outage
- voting abuse
- account takeover
- harmful content escalation
- data exposure
- failed mobile release
- push notification incident
