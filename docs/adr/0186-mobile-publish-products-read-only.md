# ADR-0186 — Mobile: Publish product catalogue, read-only

**Status:** Proposed 2026-10-20
**Related:** parity phase P5 in `docs/mobile/PARITY-2026-10-19.md` section 4; [ADR-0185](0185-mobile-publish-ads-read-only.md)

## Decisions

1. **Product list.** `GET /commerce/products` lists the brand's products: picture, title, price (and the old price when it is higher), status, stock, number of options, the shop's host, and a sync error when there is one. Text is plain and bounded; a picture shows only from an https address; a product link is shown as its host and never opened.
2. **Nothing is changed from the app.** Adding, editing and deleting products, syncing a shop, collections and discounts stay on veyrnox.ai ("Manage products on veyrnox.ai" opens the Publish page in the in-app browser). Commerce is catalogue management only; no checkout, no payment and no credits are involved.
3. **Plan.** A free account's 402 and a flag-off 404 each have their own message. The Unlock card with store prices (ADR-0162) is used for ads in ADR-0185; this slice shows the 402 as text so it does not depend on that PR, and can swap to the card once both are on main.
4. No server change, no dependency, no flag. Unit tests only; the screen was not run on a device.
