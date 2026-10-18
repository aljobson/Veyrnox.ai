# ADR-0139 — Mobile: Publish drafts, read-only (M11 slice 3c)

**Status:** Proposed 2026-10-18
**Related:** [ADR-0061](0061-veyrnox-publish-social-scheduling.md) (Publish); [ADR-0137](0137-mobile-publish-brands-approvals.md) (brand choice); [ADR-0138](0138-mobile-publish-calendar-best-time.md)

## Decision

A read-only **Drafts** screen (`/publish/drafts`): the posts in the chosen brand that are waiting for someone to approve or discard them, grouped by the batch that made them, each with its text, planned time, networks and the kind of media. No new server route, flag or dependency. It uses the brand-aware client from ADR-0137.

**Approve and discard are not built.** `POST /api/v1/social/drafts` with `approve` schedules real posts to real networks, and with `discard` deletes content for good. Neither belongs on a phone without the owner's say-so, so the screen says so and links to veyrnox.ai. If the owner wants them, they should come with a confirm that names the networks (as Post now does in the composer) and the same idempotency and role rules the route already has (approve and discard are allowed for owner, manager and reviewer only).

## Choices that matter

- Media job ids are not kept; only the kind of media (image, video) is shown. Text is bounded.
- Drafts with no batch are shown as their own group, with their own heading.
- Errors are plain: a brand that is not theirs (404), rate limited, offline, not configured.
- New strings are `drafts.*` keys, English only, listed in `docs/mobile/I18N-NEW-KEYS.md`; counts use singular and plural forms.

## Proved, and not

Proved on the simulator against the mock server: three drafts in two groups (a batch of two and one with no batch), planned times in local time, networks and media kinds, and the link. 8 new unit tests (parsing, tolerance, bounded text, no job ids, grouping, error mapping).

Not proved: any real server, the real field values beyond `0182_social_post_drafts.sql`, a list at the server's 200-draft limit, and that the veyrnox.ai link opens the right page when signed out.

## Follow-ups

Approve and discard on the phone (owner's decision). Connecting a network (slice 4) with the server's ADR-0136 return target.
