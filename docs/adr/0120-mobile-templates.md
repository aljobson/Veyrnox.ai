# ADR-0120 — Mobile: Templates

**Status:** Proposed 2026-10-18
**Related:** [ADR-0106](0106-mobile-app.md) (the app), roadmap slice M10b

## Context

The web app has a template gallery: ready-made prompts for a model, with a preview. The server now serves it to the app as data, `GET /api/presets` (anonymous, read-only, cached, priced from the live catalog). The app had no way to start from one.

## Decisions

1. **A Templates screen** (`/create/presets`), reached from the top of Create. Templates are grouped by the server's category, each row showing the poster, the title, a NEW mark, the server's price with the template's length ("68 credits · 10 s") and what the person must supply ("Needs: ..."). Nothing is cached or kept on the device.
2. **Price is the server's number.** For an active model, the row shows its catalog price from the response. When a model has no active catalog row, the endpoint sends the same template fallback price the web gallery shows and `available: false`. The app computes no price. The order form still shows the catalog price for the length chosen, and the server still refuses if the price changed (`confirmedCredits`).
3. **Tapping an available template opens the existing form for its model**, with the template's prompt and length filled in and still editable. Files a template needs go through the existing pickers; nothing new is uploaded or sent by the Templates screen. An unavailable template routes to the Templates screen's clear "not available right now" state and never opens Create.
4. **Gated templates are hidden**, because their model is one the app does not offer (`gated`). A template with no whole positive price, no model or no prompt is dropped. Preview links that are not `https` are ignored. Templates whose model is inactive remain visible and are marked unavailable.
5. **Video previews are not played in the list.** Only the poster image is shown, which keeps the list light. Playing the preview is later work.
6. The public presets response adds the `available` boolean. There is no new route, dependency or flag.

## Consequences

- The list shows every non-gated web template at once, grouped, including templates whose models are inactive. Paging is not needed yet.
- A template whose model is inactive never reaches the form; its card remains browsable and opens the explicit unavailable state.
