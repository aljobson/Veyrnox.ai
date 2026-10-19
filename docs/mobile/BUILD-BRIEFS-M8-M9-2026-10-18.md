# Build briefs for the next mobile slices

**Status:** Draft 2026-10-18. Start M9 and M8 after the M10a PR merges, because they share `package.json`, the lockfile, the tab layout and `app.json` with it. One PR per slice. Rules for every slice: no flag enabled, no server or migration edits (list a missing route instead), no `docs/mobile` roadmap edits, branch from `origin/main`, re-read any API route on `main` before building against it.

## M9: Cinema free viewing

**Read first:** `docs/mobile/CINEMA-PLAYBACK-SPIKE-2026-10-18.md`.
**Do first (part 2 of the spike):** mint a token for a free title on staging and play `https://customer-<code>.cloudflarestream.com/<token>/manifest/video.m3u8` in `expo-video` on an iOS simulator and an Android device. Record the result in that note. If HLS fails, fall back to a web view on the `/iframe` URL and say so.
**Then build:** a Cinema tab with a vertical paged feed from `GET /api/cinema/titles` (cursor `next` / `next_id`), one active player, poster images from `/api/cinema/posters/:id`, a title page, sign-in prompt when a signed-out viewer taps play, mint on play (not on scroll), renewal about 3 minutes before `expires_at` with a seamless swap, heartbeat every ~30 s of visible playing time (stop on `free_ceiling` / `pass_ceiling`), audience call as best effort.
**Out of scope:** unlocks, Pass, voting, comments, creator tools (M12 and later).
**Done when:** a free title plays on both platforms, the token renews without a visible gap in a 20-minute soak, and a locked title shows the reason instead of a spinner.

## M8: foundations (split into three small PRs if it grows)

1. **Translations:** the web has 11 locales (ADR-0107; strings under the web messages folders on `main`). Reuse them: find how the web loads them, copy the keys the app needs, add a small `t()` with the device locale and an English fallback. No machine translation of new strings; list new keys for the localization process instead.
2. **Cache and offline:** cache balance, Library list and model catalog (stale-while-revalidate), show a clear offline banner, never queue a paid action offline.
3. **Accessibility:** labels, roles and focus order on every screen (today there is one `accessibilityLabel`), dynamic type, reduced motion, 44 pt targets.
**Done when:** each PR has tests, `npm test` and typecheck in `apps/mobile` pass, and the screen reader reads the sign-in, Create and Account flows on iOS.
