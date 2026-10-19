# ADR-0120 — Mobile: Templates

**Status:** Proposed 2026-10-18
**Related:** [ADR-0106](0106-mobile-app.md) (the app), roadmap slice M10b

## Context

The web app has a template gallery: ready-made prompts for a model, with a preview. The server now serves it to the app as data, `GET /api/presets` (anonymous, read-only, cached, priced from the live catalog). The app had no way to start from one.

## Decisions

1. **A Templates screen** (`/create/presets`), reached from the top of Create. Templates are grouped by the server's category, each row showing the poster, the title, a NEW mark, the server's price with the template's length ("68 credits · 10 s") and what the person must supply ("Needs: ..."). Nothing is cached or kept on the device.
2. **Price is the server's number.** The row shows `credits` from the response. The app computes no price. The order form still shows the catalog price for the length chosen, and the server still refuses if the price changed (`confirmedCredits`).
3. **Tapping a template opens the existing form for its model**, with the template's prompt and length filled in and still editable. Files a template needs go through the existing pickers; nothing new is uploaded or sent by the Templates screen.
4. **Gated templates are hidden**, because their model is one the app does not offer (`gated`). A template with no whole positive price, no model or no prompt is dropped. Preview links that are not `https` are ignored.
5. **Video previews are not played in the list.** Only the poster image is shown, which keeps the list light. Playing the preview is later work.
6. No server change, no new dependency, no flag.

## Consequences

- The list shows every non-gated template at once (about 110), grouped. Paging is not needed yet.
- A template whose model the app cannot run still reaches the form, which says "That model is no longer available." This is rare, since the server leaves out templates whose model is inactive.
