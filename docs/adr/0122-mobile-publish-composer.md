# ADR-0122 — Mobile: Publish composer

**Status:** Proposed 2026-10-18
**Related:** [ADR-0061](0061-social-publish.md) (Publish), [ADR-0121](0121-mobile-publish-overview.md) (the read-only screens), [ADR-0106](0106-mobile-app.md), roadmap slice M11

## Context

ADR-0121 let a person see their accounts, posts and analytics. This slice lets them make a post: pick one of their creations, choose accounts, write the text, post now or schedule it, and later change the time, cancel or restore a scheduled post.

## Decisions

1. **The composer** (`/publish/compose`, from a "New post" button on Posts) has four steps on one screen: a finished image or video from the Library, the accounts, the text, and when. A creation's type (image or video) comes from the catalog modality of its model, since a Library job does not carry one. Audio and chat creations are not offered.
2. **Accounts offered** are only those that are connected, have publishing open (`publishingEnabled`) and take the creation's media type (`supportedMedia`). The server remains the authority on every rule; the app checks only to save a round trip.
3. **Post now sends `publishNow: true`**, so the server's clock decides and the phone's time never matters. A schedule sends the chosen instant as ISO time and must be more than a minute away.
4. **Confirm before sending.** A system dialog names the accounts and says whether it posts now (public, not undoable from here) or at a time (changeable until it starts). Nothing is sent without it.
5. **One post per draft.** The idempotency key is kept for an unchanged draft, so a retry by the person after a dropped connection cannot post twice. The app never retries a create by itself. The key is held in memory only: if the app is closed in the middle of a send, a new attempt gets a new key and could post twice, so the person should check Posts before trying again.
6. **Text** is limited to 4000 characters, as the server does. A hint names the first chosen network whose own limit the text passes (a small table copied from the server's network list); it warns, it does not block.
7. **No native date picker.** Quick choices (in an hour, tomorrow 9:00, in a week) and typed `YYYY-MM-DD` and `HH:MM` in the phone's time zone. This avoids a new native dependency and a rebuild.
8. **Changes from the post screen:** reschedule (`PATCH /posts/:id/schedule`, using the post's `scheduled_at` as the version), cancel and restore (`PATCH /posts/:id` with `expectedUpdatedAt`). Cancel and restore need the post's `updated_at`, which the server's post list rows do not carry; the server is adding it to the single-post row, and the post screen will read that row once it is live. Until a row carries it the app hides those buttons and says they are not available in the app yet. A 409 (already started, changed elsewhere) asks the person to reload.
9. **Plan wording comes from the server's 402.** Scheduling, more than one account and variants name what needs the Publish Plan; Post now stays available on the free plan if the server allows it.
10. No server change, no dependency, no flag.

## Not decided here

- Connecting a network (OAuth through app links needs a signed device build), drafts, per-network text, YouTube visibility, uploading a file straight to a post (the social upload route and its flag), thumbnails in the creation list.

## Consequences

- Posting reaches real social networks once the server flags are on. The app was proved only against the dev mock; nothing was posted to a real network.
- The `updated_at` gap is a server request: add `updated_at` to the post list and by-id rows.
