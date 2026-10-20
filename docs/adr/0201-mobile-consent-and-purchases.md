# ADR-0201: Mobile assistant consent and purchase history (parity plan P7, slice 4)

**Status:** Proposed 2026-10-19. Builds on ADR-0149 (the app talks to Supabase Auth with the user's token).

## Decision

- **Consent screen** (`/oauth-consent?authorization_id=`): the web's `/oauth/consent` for the phone. It loads the
  request (`GET /auth/v1/oauth/authorizations/:id`), shows who is asking, what the connection can and cannot do and the
  scopes, and sends `POST .../consent { action: approve | deny }`. The wording is the web's own (the `oauth.*` keys
  were added to the shared web key list, so every language gets the web's translation verbatim).
- **Where the answer sends the person:** the response's redirect is opened only if it is `https`, a loopback `http`
  address, or another app's own custom scheme; never `javascript:`, `data:`, `file:`, `intent:` or plain `http` to a
  real host. If there is nothing safe to open, the screen says so instead.
- **Publish wording:** the web picks the Publish summary from a server flag the app cannot see. The app shows it when
  the request names a scope containing "publish", and otherwise the base wording, which lists fewer permissions.
- **Link:** `mapAppLink` maps `https://veyrnox.ai/oauth/consent?authorization_id=` to the screen; the id is checked
  against `[A-Za-z0-9_-]{8,128}` and anything else goes to Home.
- **Credit purchases** (`/topups`, from Account): `GET /api/v1/top-ups` newest first with the same keyset cursor as the
  credit history. Read-only: date, credits, price paid, status (waiting for payment, credits added). Nothing starts a
  purchase; credits are bought only in the store.
- Long lists on the screens from slices 1 to 3 now end with `VEY_CLEARANCE` padding so the last row clears Vey.

## Needs the server or app config (not done here)

The link only reaches the app once `/oauth/consent` is in `APP_LINK_PATHS` (`lib/mobileAppLinks.js`) and the Android
`intentFilters` in `app.json`. Until then the screen is reachable inside the app only.

## Not proved

Unit tests with mocks; not run against Supabase Auth (the consent response fields are read from the web page's
fallbacks), a simulator or a phone.
