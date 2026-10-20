# ADR-0237: Help guides on the phone; Cinema series remains open

Status: Accepted.
Date: 2026-10-20

The frozen work order's Revision 2 covers Guides only. The web list and detail pages
read `app/veyrnox/_lib/guides.js`, a plain static module with five guides. There is
no guide API or availability flag to call or add.

Help now links to `/guides`, with `/guides/[id]` showing the summary, numbered
steps and next destinations. Both screens follow the existing Help and Create
Tools styling. They scroll with font scaling, label headings as headers, use
44-point or larger controls and add no animations. An unknown ID or failed
browser launch shows “Not available yet” without an exception message.

`apps/mobile/scripts/sync-help-guides.mjs` generates a small typed snapshot of
IDs, ordered steps, links and message keys, plus the marked source-copy section
in `src/lib/i18n/messages/en/helpGuides.ts`. It resolves the web module relative
to this checkout. Metro only imports mobile TypeScript; it does not need to
resolve the web source or load server code. All English copy lives in the new
area file. Regenerate with:

```sh
cd apps/mobile
node scripts/sync-help-guides.mjs
node scripts/gen-en-registry.mjs
```

The drift test reconstructs the complete unmodified guides from the generated
data and English messages and compares them against the web module, including
order and links. A generator `--check` test also catches stale output.
Separately tested keyed presentation overrides describe App Store/Google Play
credit purchases, account favourites stored on this phone, and model selection
without the website's right-hand list. The generator preserves these manually
authored mobile strings.

Presentation policy permits mobile overrides to hide individual steps that do
not apply on the phone, but not whole guides. The shared guide list remains
complete; the current overrides change wording only and hide no steps.

Create, Pricing, Templates, Tools, Library and Credits links open their existing
native screens. Pages without a native destination, currently Acceptable Use
and Refund Policy, open on `https://veyrnox.ai`. Guides themselves are bundled
and need no network request. Destination screens retain their existing server
availability and purchase handling.

Cinema series is deliberately an open gap, not part of this implementation:

- The web series page reads `editorialSeries.js`; its episodes use YouTube
  playback, not a series API.
- `/api/v1/cinema/titles/[id]` calls `read_public_cinema_title`, whose root lookup
  requires `parent_id IS NULL` (see
  `packages/db/schema/supabase/0149_cinema_categories.sql`). Database child
  episodes therefore cannot simply open through the existing title endpoint.

A later decision must choose the series model and episode navigation. No Cinema
screen, player, endpoint, flag, migration, billing flow or analytics SDK changes
are included here.

Validation is `cd apps/mobile && npx tsc --noEmit && npx jest --ci && node scripts/gen-en-registry.mjs --check`,
plus the guide generation check. New tests were run before implementation and
failed because the guide module was absent.
