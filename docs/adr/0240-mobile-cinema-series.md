# ADR-0240: Cinema series on the phone

Status: Accepted.

This closes the Cinema series decision left open by ADR-0237 (mobile Help guides).
The existing Series tab shows bundled editorial series before database series,
matching web discovery. Editorial rows remain available when the first database
read fails or viewing is closed. Category display uses the phone's existing
categories; adventure is filtered out.

The plain web editorialSeries.js module is projected into generated TypeScript.
The snapshot contains series metadata and ordered episode IDs, titles, positions
and durations. It excludes playback metadata and creator channel URLs. Validation
rejects invalid identifiers, poster origins, episode order, durations and duplicate
episode IDs before writing. Drift tests compare the projection with the web source.
Content titles and descriptions remain data, as on the web, while interface copy
lives in the app-only cinemaSeries English area.

The editorial detail screen makes no API reads. Posters load from i.ytimg.com,
as on the web. Episodes open the public veyrnox.ai watch page with
WebBrowser.openBrowserAsync; the public page performs YouTube playback. The phone
has no embedded player, price, progress, save, follow, comment, vote, share or report
controls for editorial series. Browser errors show quiet retry copy.

Database series keep /cinema/[id]. Child episodes open only through the watch
screen, carrying their parent UUID in the series parameter. Title-level actions
stay on the parent series. Detail entitlement is unmetered: the series screen
calls the existing fetchEntitlement only for episodes whose detail lock is null
(free). Reads run sequentially in season/episode order, including across rapid
focus changes, to protect the shared account read quota. Completed checks are
retained only in the mounted screen across unchanged focus cycles; playback
invalidates them so returning refreshes the metered state. Changed detail or API
identity also triggers a new check. Stale focus reads cannot update eligibility.
Metered eligibility determines row labels and the first playable episode. Paid,
pass and unlocked detail never becomes free-only app eligibility. Credit amounts
are never shown. Film and short Play behavior is preserved.

All episodes dismisses the watch route to /cinema/<seriesId> when its parent is
in the stack (matching UUIDs without case sensitivity), and calls router.replace
when the parent is absent. Removing the route unmounts
CinemaPlayer and invokes its existing session stop, heartbeat/audience flush,
timer cleanup and pause. No player, playback, progress, server or app-link code
changes are needed. Tests exercise the installed SDK stack reducer and actual
player/session cleanup for both existing and absent parents.

Trap: /social-cinema/* is not in APP_LINK_PATHS (lib/mobileAppLinks.js).
If it is ever added, mapAppLink (apps/mobile/src/lib/appLinks.ts) currently maps
non-UUID editorial watch links to /. The in-app browser must keep working;
that change needs an editorial route first.

Regenerate from apps/mobile:

```sh
node scripts/sync-cinema-series.mjs
node scripts/gen-en-registry.mjs
```

Verify from apps/mobile:

```sh
npx tsc --noEmit && npx jest --ci && node scripts/gen-en-registry.mjs --check && node scripts/sync-cinema-series.mjs --check
```

From the repository root also run:

```sh
node --test tests/cinemaEditorialSeries.test.mjs
```
