# ADR-0171: Mobile team invitation and post review links (parity plan P7, slice 6)

**Status:** Proposed 2026-10-19. Builds on ADR-0135 (Publish brands) and ADR-0136 (hand-back routes).

## Decision

- **Team invitation** (`/team-invite?token=`, signed-in area): reads `GET /api/social/team/:token` (no sign-in, the
  token is the credential) and shows brand, role and the address the invitation was sent to. Accept is
  `POST /api/v1/social/team/accept { token }` with the normal bearer token (not the Publish brand header). On success the
  brand becomes the chosen Publish brand, as on the web. A 403 (signed in under another address) names the right address.
- **Post review** (`/review?token=`, outside the signed-in area, like the web page): reads
  `GET /api/social/approvals/:token`, shows the post (networks, text per network, image preview or a "watch" button for
  video), the planned time and the approval policy, and takes one decision with an optional comment of up to 2,000
  characters (`POST` with `approved` or `rejected`). The preview address is only ever a `/media/social/…` path joined to our
  own host.
- **Links:** `mapAppLink` maps `/social/team/invite/:token` and `/social/review/:token` to the two screens. A token is
  `a.b` url-safe parts (checked for shape, never logged); the server verifies the signature and expiry.

## Needs the server or app config (not done here)

Neither path is in `APP_LINK_PATHS` (`lib/mobileAppLinks.js`) or the Android intent filters in `app.json`, so a tap in a
message still opens the browser. Until they are added the screens are reached inside the app only. A review link also
needs a signed-out visit to reach `/review`, which sits outside the sign-in gate on purpose.

## Not proved

Unit tests with mocks; not run against the server (response fields are read from the two routes), a simulator or a
phone. Screens have no component tests.
