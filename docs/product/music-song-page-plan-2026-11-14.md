# Music song page parity: plan (2026-11-14)

Status: plan only, nothing built. The owner chose the full Suno-style song page, comments included (2026-11-14).
Source: `docs/product/suno-music-parity-spec.md` section 5, "P1. Song page parity".

## What exists today

| Piece | State | Where |
|---|---|---|
| Public track page | Built | `app/veyrnox/music/tracks/[slug]/page.js`, `MusicPublicTrack.jsx`, `/api/music/public/:slug` |
| Public creator profile | Built | `app/veyrnox/music/creators/[handle]/page.js`, `/api/music/profiles/:handle` |
| Like and dislike (private songs) | Built | `/api/v1/music/songs/:id/feedback`, `0466` |
| Comments, replies, reactions, Follow | Gap | none |
| Similar and By-creator rails, Song radio, Add to queue | Gap | none |

Cinema already has a full comment system to copy: `0267_cinema_preapproved_comments.sql` (comments, reports, idempotent mutations, admin approval), plus user blocks (`0353`) and the export and erasure wiring (`0362`, `0364`).

## Slices, in build order

Each slice ships behind a new `MUSIC_RUNTIME_FLAGS` key that starts `false` (no new Worker binding).

### Slice 1: reactions and Follow (about 1 day)
- `music_song_reactions`: one row per (person, public song), one of 7 emoji. Counts on the public track.
- `music_creator_follows`: (follower, creator). Follow button on track and profile pages; follower count on the profile.
- Writes through `/api/v1/music/...` RPCs with idempotency keys; public counts read anonymously through the existing public routes.
- Flag: `reactions`, `follows`.

### Slice 2: rails and queue (about 1 day, no new tables)
- By-creator rail: the creator's other published tracks (existing publication data).
- Similar rail: published tracks sharing the most style words, ranked in SQL. No model calls.
- A queue in the browser (session only, nothing stored), "Add to queue" and "Song radio" (fill the queue from the Similar rail).
- The audit's top gap, a persistent player across pages, belongs here: one player in the app shell.
- Flag: `rails`.

### Slice 3: comments (about 2 days)
- Copy the Cinema model: `music_comments` (text only, 1-1000 chars, optional timestamp in the song, one level of replies), `music_comment_reports`, `music_comment_mutations`.
- Visible only on public songs. Every comment is held for administrator approval before anyone else sees it (owner, 2026-11-14), using the Cinema review queue pattern.
- Comment likes: `music_comment_likes`.
- Blocks: reuse the Cinema block list or add a Music one.
- Flag: `comments`.

## Rules every slice must meet
- RLS on and forced on every new table; service-role writes through RPCs; `SET search_path = ''`; explicit REVOKE and GRANT.
- Every new table that references `users` is classified in `scripts/test-account-deletion.mjs` and erased with the account; included in the privacy export.
- Every write takes an idempotency key; replay is a no-op.
- No price, no credits: none of these features spends or grants credits.
- Text is rendered as text, never HTML. Length caps at the API boundary and in SQL.
- New anonymous read routes are added to `tests/routesOutsideGate.test.mjs` and CLAUDE.md.
- All new strings in the 11 locales. UI ends with the design goal criteria lines.

## Open questions for the owner
1. ~~Comment moderation~~ **Decided 2026-11-14: every comment waits for administrator approval, as in Cinema.**
2. **Who can comment.** Any signed-in account, or only accounts on a paid plan?
3. **Notifications.** Should a follow or a reply notify the creator (push and email exist)?
4. **Order.** Ship slices 1 and 2 first and decide comments later, or build all three before any goes on?
