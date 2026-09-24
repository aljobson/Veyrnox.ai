# 1. Product & Functional Specification

## 1.1 Product vision

Veyrnox.ai is a community-ranked short-form entertainment platform designed around episodic storytelling. Creators publish series in short episodes. Viewers watch, follow, share and vote. Veyrnox.ai uses qualified community engagement to determine weekly winners and to surface stories audiences want to continue.

### Product proposition

**Watch. Vote. Decide what happens next.**

## 1.2 MVP objectives

The MVP must prove five assumptions:

1. Users will consume vertical episodic video.
2. Users will vote after watching.
3. Voting and weekly competition increase return frequency.
4. Creators will publish multi-episode content.
5. A transparent ranking model can surface quality without simply rewarding the largest existing audience.

## 1.3 Primary user roles

### Viewer
- Create an account and profile.
- Browse the For You feed.
- Discover series by category and trend.
- Watch episodes.
- Vote on eligible episodes and series.
- Follow creators and series.
- Save and share content.
- Receive new-episode and voting notifications.
- Report content.

### Creator
All Viewer capabilities plus:
- Create a creator profile.
- Create and edit a series.
- Upload and publish episodes.
- Select episode artwork and metadata.
- Open audience story decisions.
- View performance metrics.
- Review community voting results.
- Manage draft, scheduled and published content.

### Moderator
- Review reported content.
- Hide, restrict or remove content.
- Suspend creator publishing.
- Review voting anomalies.
- Manage featured and winner content.
- Maintain moderation notes and audit history.

### Administrator
- Manage roles and platform configuration.
- Configure ranking weights and competition windows.
- Manage categories and featured placements.
- Review operational dashboards.
- Manage escalations and platform-level restrictions.

## 1.4 Navigation model

The mobile application uses four primary tabs.

| Tab | Purpose |
|---|---|
| **For You** | Full-screen personalised vertical video feed |
| **Series** | Browse series, categories, new releases and followed content |
| **Vote** | Content currently eligible for voting and story decisions |
| **Winners** | Weekly winning episodes, series and creators |

Supporting navigation includes Profile, Search, Notifications, Creator Studio and Settings.

## 1.5 Functional requirements

### FR-001 Account registration
Users shall be able to register using email-based authentication. Social sign-in may be enabled later.

### FR-002 Profile
Users shall have a public profile with display name, avatar, biography and follower counts. Sensitive account attributes must not be publicly exposed.

### FR-003 Series creation
Creators shall create a series with:
- title
- synopsis
- cover image
- genre/category
- content rating
- status
- language
- optional tags

### FR-004 Episode upload
Creators shall upload video directly to the managed video service using a time-limited creator upload URL. Application API credentials must never be exposed in the client.

### FR-005 Episode publishing
Episodes shall support Draft, Processing, Scheduled, Published, Hidden and Removed states.

### FR-006 For You feed
The application shall render full-screen portrait video with fast transitions, preloading and continuity between episodes.

### FR-007 Watch progress
The system shall capture watch start, progress checkpoints, completion and rewatch events.

### FR-008 Qualified vote
A signed-in user may cast one qualified vote per voting target within the active competition period unless the product defines a separate story-choice ballot.

### FR-009 Story-choice vote
An episode may optionally ask a multiple-choice question. A user may make one selection while the poll is open.

### FR-010 Weekly ranking
Eligible content shall receive a weekly score from qualified engagement signals and fraud controls.

### FR-011 Winner publishing
The system shall support automatic provisional winners and moderator-approved final publishing.

### FR-012 Following
Users shall follow creators and/or series.

### FR-013 Notifications
Users shall receive opt-in notifications for new episodes, active votes, followed series and published weekly winners.

### FR-014 Reporting
Users shall report content using defined reason codes and optional comments.

### FR-015 Moderation
Moderators shall review a queue of reports and apply content or account actions.

### FR-016 Creator analytics
Creators shall see views, unique viewers, completion rate, qualified votes, shares and follower growth.

## 1.6 Non-functional requirements

| Area | Requirement |
|---|---|
| Availability | Target 99.9% service availability for MVP application APIs excluding third-party outages |
| Performance | Feed metadata API p95 < 500 ms under expected MVP load |
| Playback | Video should begin as quickly as network conditions permit using adaptive streaming |
| Security | Least privilege, RLS, secure token handling, server-side privileged operations |
| Privacy | Collect only data necessary for product operation and safety |
| Scalability | Stateless API patterns and managed video distribution |
| Auditability | Admin and moderation actions must be auditable |
| Accessibility | Mobile UI should support scalable text, labels, contrast and screen readers |
| Observability | Centralised application, error, security and media pipeline telemetry |

## 1.7 MVP exclusions

The first release does not require:
- live streaming
- creator revenue sharing
- paid episode unlocking
- advertising marketplace
- advanced ML recommender training
- long-form studio production workflow
- complex DRM
- crypto/token rewards
- desktop creator editing suite
