# ADR-0228 — Mobile: Publish ad drafts can be created, edited and deleted

**Status:** Proposed 2026-10-20
**Related:** [ADR-0185](0185-mobile-publish-ads-read-only.md) (amended by this ADR: the list was read-only), parity phase P5 in `docs/mobile/PARITY-2026-10-19.md` section 4, [ADR-0229](0229-mobile-publish-product-catalogue-writes.md)

## What the web lets a person do with ads

`/app/publish/ads` calls `PUT` and `DELETE /api/v1/social/ads` and nothing else. Those are the only ad write routes under `/api/v1`. Server side (`0321_social_ads_commerce.sql`) a campaign is a saved row; "provider launch/sync remains closed", so no ad is placed on Meta, Google, TikTok, LinkedIn or X, and no money moves.

| Write action | Route | Plan gate and errors | Spends money? | Posts publicly? | On the phone |
|---|---|---|---|---|---|
| Create a draft (standalone or boost of a published post) | `PUT /social/ads` | 402 `plan_required`, 403 `forbidden`, 404 `ads_not_open` / `post_not_found`, 409 `campaign_limit`, 400 `invalid_body` | No (a draft row) | No | Built |
| Edit a draft | `PUT /social/ads` with `id` | as above, plus 409 `campaign_not_editable` unless status is `draft` | No | No | Built |
| Delete a draft | `DELETE /social/ads?id=` | 409 `campaign_not_editable` unless `draft` | No | No | Built, behind a confirm |
| Start, pause, resume, complete a campaign | none in `/api/v1` | not exposed | Would | Would (a paid ad on a third-party network) | Not built; no route exists on the web either |
| Attach a product to a campaign or post | none in `/api/v1` | not exposed | n/a | n/a | Not built; no route exists |

## Decisions

1. **Drafts only.** The phone gets the same three actions as the web, over the same routes, with the same plan gate (a 402 shows the Unlock card with store prices, ADR-0162), role gate (owner, manager and editor see the buttons; other roles see the list) and typed error codes (each code has its own message). The request is checked on the phone with the server's own limits first (name 1-120, budget 1.00 to 1,000,000, three-letter currency, at most 20 places and 20 interests of 80 characters, ages 13-100, https links, end after start, a boost needs a post).
2. **Nothing that spends or posts.** The editor says in words that it saves a draft only, and that starting, pausing and spending are only on veyrnox.ai. The existing "Create or change campaigns on veyrnox.ai" row stays, with an added line for launching. Only a `draft` row has Edit and Delete; the server refuses anything else (409).
3. **Links are data.** The destination and lead-form links are typed or edited as text and saved; they are never opened from the app, and the list still shows the host only.
4. **Boost.** The post to boost is chosen from the brand's latest published posts (one page, 20 shown), as on the web.
5. No server change, no dependency, no flag, no migration. Unit tests cover request building, the round trip of an edit, roles and error codes; the screens were not run on a device.
