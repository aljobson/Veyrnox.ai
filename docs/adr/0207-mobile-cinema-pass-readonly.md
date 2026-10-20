# ADR-0207: Mobile Cinema Pass, read-only, and the paid locked state (parity P6)

**Status:** Proposed 2026-10-20. Builds on ADR-0164 and ADR-0143. No purchase, price or unlock is added.

## Decision

- **Pass card.** The Profile tab shows a Cinema Pass the account already has, read from `GET /api/v1/cinema/pass`: pending, active (renews on or ends on a date), or ended. With no Pass, with the route closed (`cinema_not_open` or `pass_not_open`), or on an error, the card is simply absent. It says "you manage a Pass where you bought it".
- **No price, no plan, no buy button, no link to buy.** The server exposes only the Stripe price (`price_usd_cents`), and ADR-0143 forbids mentioning a web price or steering to web checkout from the app. A store price exists only after the store product and RevenueCat offering are set up (owner checklist in ADR-0143), so there is nothing the server can give the phone to show yet. `price_usd_cents` is deliberately not parsed.
- **Paid locked state.** An entitlement answer of `locked` with a credit price now reads "This is a paid title. Paid titles are not available in the app yet", not the generic message. The credit amount is not shown: spending credits on content is the open Apple 3.1.3(b) check.
- A Pass holder whose entitlement is `pass` already plays: the entitlement read treats it as open (ADR-0164).

## Not built, and why

- **Continue watching:** no route reads watch progress (retention holds saved titles and follows; audience only accepts progress). It needs a server read route.
- **My List:** the retention routes have one saved list, which the web calls Saved (ADR-0178). The phone's Saved tab is that list.
- **Store price on the Pass card:** blocked on the store product, RevenueCat offering and a server field that returns the store price.

## Not proved

Jest only; the shape is from `lib/cinema/passApi.js`. No device and no run against staging.
