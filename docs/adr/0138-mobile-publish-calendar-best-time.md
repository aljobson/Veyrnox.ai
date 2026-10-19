# ADR-0138 — Mobile: Publish calendar and best time (M11 slice 3b)

**Status:** Proposed 2026-10-18
**Related:** [ADR-0061](0061-veyrnox-publish-social-scheduling.md) (Publish); [ADR-0121](0121-mobile-publish-overview.md), [ADR-0122](0122-mobile-publish-composer.md), [ADR-0137](0137-mobile-publish-brands-approvals.md) (the screens and brand choice this builds on)

## Decision

Two read-only screens, no new server route, flag or dependency. Both use the brand-aware client from ADR-0137, so they follow the chosen brand.

1. **Calendar** (`/publish/calendar`). One local Monday-to-Monday week at a time from `GET /api/v1/social/calendar`, with previous, next and back-to-this-week. Posts are grouped by day in the phone's own time zone; each row shows the time, the text, the status and the networks (a failed network is marked). A tap opens the existing post screen, which already owns cancel, restore and reschedule, so the calendar adds no new way to change anything. Pages follow the server's cursor up to five pages (500 posts); if a week still has more, it says so.
2. **Best time** (`/publish/best-time`). For one connected account, the strongest three weekday-and-hour slots and a weekly posting-frequency table, from `GET /api/v1/social/best-time`. The evidence rules are the web's own, copied with their constants (`lib/social/postingInsights.js`): a slot needs at least 3 measured posts, the account at least 10 measured posts over 14 days, and a slot with no interactions is never ranked; below that the screen says there is not enough evidence rather than guessing. It states that this is past performance and does not predict an audience or show that posting more causes more engagement. Day and hour are in the brand's time zone, which is shown. The 7 by 24 heat grid is not shown: it does not fit a phone, and the three best slots carry the same decision.

## Choices that matter

- A week is built with calendar arithmetic, so a week with a clock change is still seven local days and always far inside the server's 43-day limit.
- Calendar rows reuse the posts parser plus the three `can_*` flags, and keep `updated_at`, which is the version stamp the post screen needs.
- Errors are plain and specific: no plan (402), feature not open (503), a brand or account that is not theirs (404), rate limited, offline.
- New strings are `calendar.*` and `insights.*` keys, English only, listed in `docs/mobile/I18N-NEW-KEYS.md`. Counts use singular and plural forms.

## Proved, and not

Proved on the simulator against the mock server: the current week and the next week with their posts in local time; a tap opening the post; the best-time screen with three ranked slots, the frequency table and the disclaimer. 21 new unit tests (parsing, week bounds including a clock-change week, day grouping, cursor paging, the evidence rules and tie-breaks, error mapping).

Not proved: any real server, the real field values beyond those read from `0191_social_posting_insights.sql` and `0311_social_post_cancel_restore.sql`, a week with more than 500 posts, the "not computed yet" and "not enough evidence" states on a device (covered by unit tests and a mock switch only), and the heat grid.

## Follow-ups

Drafts (slice 3) and connecting a network (slice 4, with the server's ADR-0136 return target).
