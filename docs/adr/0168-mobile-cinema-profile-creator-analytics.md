# ADR-0168: Mobile Cinema profile, creator application and audience insights (parity P6)

**Status:** Proposed 2026-10-19. Builds on ADR-0164 and ADR-0165. Creator **upload**, drafts, submit, paid unlocks, the Pass and earnings are not in this ADR (ADR-0143 and the parity plan keep them out of this wave).

## Decision

| Screen | Route | Switch | Closed answer |
|--------|-------|--------|---------------|
| Profile tab: read, create (username, display name, bio) | `GET/POST /api/v1/social-cinema/profile` | `profiles` | 503 `profiles_not_open` |
| Creator application: read, apply (20 to 1000 characters) | `GET/POST /api/v1/creators/apply` | `creators` (needs profiles) | 503 `creators_not_open` |
| Audience insights for one own title | `GET /api/v1/cinema/creator-analytics?content_id=` | `creatorAnalytics` | 503 `analytics_not_open` |

- The Profile tab sits with the other Cinema tabs. A person with no profile sees the create form; with one, their name, handle, bio and role, then the application block (hidden when closed). The statuses are pending, approved ("Uploading is not in the app yet") and rejected.
- Field rules copy the route (username `^[a-z][a-z0-9_]{2,29}$`, display name 1 to 80, bio up to 500) only to stop a request that would certainly be refused; the server stays the authority. Each form keeps one idempotency key for its exact text, so a retry after a network error is one profile or application.
- Audience insights opens from a title page only when the retention read says the viewer is the creator (`own_creator`). It shows 28-day counts (viewers, finished, voters, sharers, commenters). The server hides counts below its minimum viewer number; the screen says so and shows no zeros.
- Every screen treats the off-switch 503 as a closed message, not an error.
- Strings: `cinemaCreator.*` in the English file and `docs/mobile/I18N-NEW-KEYS.md`.

## Gaps

- The phone has no list of a creator's own titles, so Audience insights is reached from the title page only. A list needs a creator content read the phone does not use yet.
- Approved creators cannot upload or manage titles in the app.

## Not proved

Jest and the mock only; shapes come from `creatorApi.js`, `creatorAnalyticsApi.js` and the profile route source. No device and no run against staging with the switches on.
