# ADR-0229 — Mobile: Publish product catalogue can be added to, edited and archived

**Status:** Proposed 2026-10-20
**Related:** [ADR-0186](0186-mobile-publish-products-read-only.md) (amended by this ADR: the list was read-only), parity phase P5 in `docs/mobile/PARITY-2026-10-19.md` section 4, [ADR-0228](0228-mobile-publish-ad-drafts.md)

## What the web lets a person do with commerce

`/app/publish/commerce` calls `PUT` and `DELETE /api/v1/social/commerce/products` and nothing else. Those are the only commerce write routes under `/api/v1`. Server side (`0321_social_ads_commerce.sql`) a product is a catalogue row; there is no checkout, payment, credit or public post in these routes.

| Write action | Route | Plan gate and errors | Spends money? | Posts publicly? | On the phone |
|---|---|---|---|---|---|
| Add a product | `PUT /social/commerce/products` | 402 `plan_required`, 403 `forbidden`, 404 `commerce_not_open`, 409 `product_limit`, 400 `invalid_*` | No | No | Built |
| Edit a product (title, text, price, old price, stock, links) | same, with `id` | as above, plus 409 `product_not_editable` unless `manual` and not archived | No | No | Built |
| Archive a product | `DELETE ?id=` | 404 `product_not_found` when already archived | No | No | Built, behind a confirm |
| Options (variants), collections, discount | same `PUT` body | same | No | No | Kept unchanged on an edit; changed on veyrnox.ai |
| Sync a shop, attach a product to a post, publish a product post | none in `/api/v1` | not exposed | n/a | Would be public | Not built; no route exists on the web either |

## Decisions

1. **Three actions, same routes.** Add, edit and archive use the web's routes, plan gate (a 402 shows the Unlock card with store prices, ADR-0162, replacing the text message of ADR-0186), role gate (owner, manager and editor see the buttons) and typed error codes (each has its own message). The form is checked with the server's limits first (title 1-160, description 5,000, three-letter currency, prices and stock whole numbers within range, https links).
2. **A save replaces the whole product**, so an edit sends the product's options, collections and discount back exactly as read. If any of them does not fit the server's shape, the product is not editable on the phone and says to edit it on veyrnox.ai. Nothing is dropped silently.
3. **Only a `manual` product can be edited**; a shop-synced product shows "From your shop" and only offers Archive, as the server allows. The app cannot un-archive; the confirm says so.
4. **Nothing sold, charged or posted.** The editor says it saves to the catalogue only. Product links and pictures are saved as text; links are never opened from the app, and a picture shows only from https.
5. No server change, no dependency, no flag, no migration. Unit tests cover request building, the round trip of an edit, roles and error codes; the screens were not run on a device.
