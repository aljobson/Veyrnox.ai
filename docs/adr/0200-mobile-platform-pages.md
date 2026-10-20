# ADR-0200: Mobile brand kit, search, catalogue pages, Ask Vey and About (parity plan P7, slice 3)

**Status:** Proposed 2026-10-19. Stacked on ADR-0150.

## Decision

- **Brand kit** (`/brand-kit`, from Account): `GET/PUT /api/v1/workspaces/:id/brand-kit` and `GET .../brand-assets`,
  for the default workspace (chips when there are several). The person edits name, colours (1 to 12, `#rrggbb`) and
  fonts (1 to 10 from the server's list). Text styles and attached assets are carried through every save untouched, so
  saving cannot lose them; they are made in the web editor. A save sends `expected_version` and an `Idempotency-Key`
  (kept for a retry of the same unsent change). A 409 asks the person to reload. The routes answer 404 until
  `EDITOR_SHARED_TOOLS_ENABLED` is on; the screen says so. Brand assets are listed read-only (type, size, length).
- **Search** (`/search`): runs on the phone over the app's own screens (with synonyms) and the model catalogue. No
  query leaves the device.
- **Models** (`/models`) and **What things cost** (`/pricing`): read-only from `GET /api/catalog`, grouped by kind,
  prices in credits only. Pricing never shows pack prices or any buying link; credits are bought only through the store.
- **Ask Vey** on Help: `POST /api/v1/help` with the question and up to six turns. Only the answer's words are used; the
  web's pointers to its own buttons are ignored.
- **About** (`/about`): the company facts from the site's About page, legal contact, policies and the app version.

## Not built

- **Guides.** The web guides are bundled text, not an API, and their words are about the web (Stripe checkout,
  browser-saved favourites). Copying them would break the store-billing rule. They need phone-specific copy: owner
  decision.
- Attaching assets and text styles to a kit (needs the editor); brand-asset upload.
- The web's Developer keys and webhooks (Publish items).

## Not proved

Unit tests with mocks only; not run against the server (the brand-kit GET shape `{ kit, version, canEdit }` is read from
the SQL function), a simulator or a phone. Screens have no component tests.
