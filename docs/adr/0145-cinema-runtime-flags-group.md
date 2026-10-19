# ADR-0145: One JSON binding for the Cinema switches

**Status:** Proposed 2026-10-19. Implements section 3 of `docs/mobile/FLAG-PLAN-2026-10-19.md`. Follows the pattern of `EDITOR_RUNTIME_FLAGS` and `PUBLISH_RUNTIME_FLAGS`.

## Context

Cloudflare refuses a Worker version with more than 128 text bindings (error 10055). Every
public var and every secret counts. Production and staging had no room left for the Cinema and
creator switches that full mobile parity needs, and each new "on" switch costs a binding.

## Decision

- `CINEMA_RUNTIME_FLAGS` is one var holding a JSON object. `cinemaFeatures()` (`lib/cinema/features.js`)
  reads it next to the individual vars.
- Keys are the names in `CINEMA_FEATURE_FLAGS` (`creators`, `content`, `profiles`, `uploads`,
  `subscriptions`, `unlocks`, `freeCeiling`, `publishing`, `viewing`, `voting`, `audience`, `rankings`,
  `retention`, `creatorAnalytics`, `comments`, `storyPolls`, `ppv`, `premieres`, `monetisation`,
  `recommendations`). Values are the strings `"true"` or `"false"`.
- Only the exact string `"true"` enables. An absent key is off. A malformed group (not JSON, not an
  object, an unknown key, a non-string or non-`true`/`false` value, over 2048 characters) turns the whole
  group off, so a typo can never switch something on.
- An individual `CINEMA_*` / `CREATOR_*` / `VOTING_ENABLED` / `COMMENTS_ENABLED` / `STORY_POLLS_ENABLED`
  var, when set to any value, wins over the group. It stays a rollback override.
- `CINEMA_ENABLED` stays its own var and still gates everything.
- `CINEMA_UPLOAD_RECOVERY_ENABLED`, `CINEMA_UPLOAD_REMOVAL_ENABLED` and `CINEMA_PROXY_UPLOADS_ENABLED` are read
  directly, not through `cinemaFeatures()`, so they stay individual vars.

## What moved

The nine switches `cinemaFeatures()` read from `wrangler.jsonc`, in production and in staging, with
their values unchanged: creators, content, profiles, uploads, subscriptions, unlocks, freeCeiling,
publishing, viewing. Production vars went from 66 to 58; staging from 70 to 62 (each net of the one new
var). Nothing was switched on or off.
`tests/cinemaRuntimeFlags.test.mjs` pins that `cinemaFeatures()` returns the same object, byte for byte, from
the old individual values and from the new group, for both environments. The production cap in
`tests/workerBindingBudget.test.mjs` is now 60 (was 77).

## How to add the next flag

1. Add the key and its env name to `CINEMA_FEATURE_FLAGS`, and use it in `cinemaFeatures()`.
2. Add `"key": "true"` (or leave it out to keep it off) in the `CINEMA_RUNTIME_FLAGS` JSON string in
   `wrangler.jsonc`, in staging first. Do not add a new individual var: it costs a binding.
3. Flipping an existing key is a one-word edit of that string and needs the owner's explicit word, as
   before. No migration and no secret.

## Not changed

No flag value, no route, no migration, nothing under `apps/mobile`. Binding counts for secrets are
unchanged (`SECRETS` in `tests/wranglerBindingBudget.test.mjs`). Not checked against live Cloudflare: the
count above is read from the file.
