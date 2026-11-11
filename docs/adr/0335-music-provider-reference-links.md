# ADR-0335 — Music reference links use official provider embeds

**Status:** Accepted 2026-11-11

## Context

Veyrnox Music needs a larger discovery shelf without copying recordings or artwork from YouTube or SoundCloud. A pasted URL is untrusted input, provider media has separate rights, and widening the global CSP creates a browser data-exfiltration surface. The existing owned-audio upload already provides the rights-attested path into generation.

## Options considered

1. Download provider audio and thumbnails into Veyrnox storage.
2. Store arbitrary embed HTML returned by providers.
3. Resolve a strict public-link allowlist through official oEmbed endpoints, store only minimal metadata URLs, and render official players after a user presses Play.
4. Keep only the six original Veyrnox beat seeds.

## Decision drivers

1. Respect creator rights and provider policies.
2. Prevent SSRF, stored-script injection and broad CSP egress.
3. Keep inspiration separate from licensed generation input.
4. Preserve useful artwork and playback in the Music experience.

## Trade-offs

| Option | Rights/policy | Security | Product value |
| --- | --- | --- | --- |
| Copy media | Fails without separate licences | Adds retention and takedown scope | High, but unacceptable |
| Store embed HTML | Provider-backed | Stored active markup is too broad | Medium |
| Strict oEmbed + official player | Provider remains source | Narrow fixed endpoints and hosts | High |
| Original seeds only | Safest | No new surface | Does not meet discovery need |

## Decision

The surface has its own `references` Music runtime flag. It first shipped off
and production was enabled only after migration 0493 applied successfully, so
deploy order could not expose a route whose table and RPCs did not exist yet.
Staging remains off until that separate database has the same migration.

Use option 3. The server accepts only canonical public YouTube video and SoundCloud track URLs, calls only each provider's fixed oEmbed endpoint with a bounded timeout/body, extracts a minimal safe DTO, and persists no media bytes. The database is owner-scoped and service-role-only.

Cards visibly attribute the provider and creator. A player iframe is created only after an explicit “open player” action, with autoplay disabled; the person then presses play in the provider's controls. Inspiration-only references cannot enter generation. An owned/licensed claim only reveals the existing “upload owned master” path; the provider URL is never used as model input.

Reference rows are lightweight preferences and are classified as erased account data. They must not block account deletion. Because account erasure tombstones rather than deletes the user row, a dedicated `deleted_at` trigger removes these rows; the foreign-key cascade remains a second safeguard.

The rows are deliberately outside the current generic privacy export because it has no Music section. This is an explicit, temporary data-portability trade-off: the complete stored projection is visible and removable in the private reference shelf whenever the dedicated reference rollout is enabled, and account erasure removes it independently of that UI flag. A future generic Music export must include these rows before this exclusion is removed.

The CSP adds exactly `https://w.soundcloud.com` to `frame-src` and `https://i1.sndcdn.com` to `img-src`. YouTube already has the exact privacy-enhanced player and thumbnail origins. Neither provider is added to `connect-src`, `script-src`, or `media-src`.

## Consequences

- Provider removal or disabled embedding makes the reference temporarily unplayable; Veyrnox does not create a fallback copy.
- Saved metadata can become stale until the user removes and re-adds a link.
- Loading provider artwork or playback shares normal browser request data with that provider; the page discloses this and links to provider terms.
- Real remixing continues to require a separately uploaded MP3/WAV and explicit recording/composition rights confirmation.
