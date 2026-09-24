# 3. Data Model & API Specification

## 3.1 Core entities

### profiles
Public application profile linked to the authentication identity.

Fields:
- id UUID PK
- username
- display_name
- avatar_url
- bio
- account_type (`viewer`, `creator`)
- account_status
- created_at
- updated_at

### creators
Creator-specific state.

Fields:
- profile_id UUID PK/FK
- verification_status
- publishing_status
- follower_count_cached
- total_views_cached

### series
Fields:
- id UUID PK
- creator_id
- title
- slug
- synopsis
- cover_url
- genre_id
- language
- content_rating
- status
- created_at
- published_at

### episodes
Fields:
- id UUID PK
- series_id
- episode_number
- title
- synopsis
- stream_video_uid
- thumbnail_url
- duration_seconds
- status
- publish_at
- published_at
- created_at

### view_events
Append-oriented event table.

Fields:
- id
- user_id nullable
- episode_id
- session_id
- event_type
- playback_position
- duration_seconds
- device_hash or risk identifier (privacy-minimised)
- created_at

### votes
Fields:
- id
- user_id
- target_type (`episode`, `series`)
- target_id
- competition_id
- vote_status (`qualified`, `rejected`, `under_review`)
- risk_score
- created_at

Unique constraint:
`(user_id, target_type, target_id, competition_id)`

### story_polls
- id
- episode_id
- question
- opens_at
- closes_at
- status

### story_poll_options
- id
- poll_id
- label
- sort_order

### story_poll_votes
- id
- poll_id
- option_id
- user_id
- created_at

Unique constraint:
`(poll_id, user_id)`

### follows
- follower_user_id
- target_type (`creator`, `series`)
- target_id
- created_at

### reports
- id
- reporter_user_id
- target_type
- target_id
- reason_code
- details
- status
- created_at

### moderation_actions
- id
- moderator_user_id
- target_type
- target_id
- action_type
- reason
- metadata
- created_at

### competitions
- id
- type
- starts_at
- ends_at
- scoring_version
- status

### ranking_snapshots
- competition_id
- target_id
- score
- qualified_votes
- completion_rate
- unique_viewers
- shares
- engagement_rate
- rank
- calculated_at

### featured_content
- id
- feature_type
- target_id
- starts_at
- ends_at
- source (`automatic`, `moderator`)
- approved_by

## 3.2 Authorization model

All exposed tables shall use RLS.

Representative rules:

- Public users may read Published series and episodes.
- Authenticated users may update only their own profile.
- Creators may create and edit only their own Draft content.
- Published media metadata must not be arbitrarily rewritten by clients.
- Users may insert their own votes only where an active competition exists.
- Users may not directly mark their own vote as qualified.
- Moderation actions are inaccessible to normal clients.
- Service-role operations execute only in controlled server functions.

## 3.3 API style

Use Supabase-generated APIs for simple RLS-safe CRUD and server-side functions for privileged or multi-step workflows.

### Example service endpoints

#### POST /creator/upload-session
Purpose: create a secure upload session.

Request:
```json
{
  "episodeId": "uuid",
  "maxDurationSeconds": 600
}
```

Response:
```json
{
  "uploadUrl": "one-time-url",
  "videoUid": "provider-id",
  "expiresAt": "timestamp"
}
```

#### POST /episodes/{id}/publish
Validates:
- ownership
- media Ready
- required metadata
- moderation state
- scheduling rules

#### POST /votes
Request:
```json
{
  "targetType": "episode",
  "targetId": "uuid",
  "competitionId": "uuid"
}
```

Server behaviour:
1. authenticate
2. validate competition
3. enforce uniqueness
4. calculate initial risk signals
5. create vote
6. mark qualified or under review

#### POST /reports
Creates a content safety report.

#### GET /rankings/weekly
Returns current published rankings and competition metadata.

## 3.4 Idempotency

The following operations should support idempotency:
- upload-session creation
- episode publish
- vote submission
- notification dispatch
- winner finalisation

## 3.5 Caching

Candidate cached data:
- home feed metadata
- series summaries
- weekly leaderboard
- creator public counters

Canonical decisions such as vote uniqueness, moderation state and winner approval must be database-backed rather than cache-only.

## 3.6 Data retention

A formal retention schedule should be established before production. At MVP:
- retain canonical account/content records while account is active
- retain moderation evidence for an approved period
- minimise device/fraud identifiers
- separate aggregate analytics from identifiable data where possible
- support account deletion and content deletion workflows subject to legal/safety retention needs
