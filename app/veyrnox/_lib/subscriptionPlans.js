export function creditUnitPrice(offer) {
  if (
    !offer ||
    !Number.isFinite(offer.price_usd_cents) ||
    !Number.isFinite(offer.credits) ||
    offer.credits <= 0
  ) return null;
  return offer.price_usd_cents / offer.credits;
}

export function bestPackUnitPrice(packs) {
  if (!Array.isArray(packs)) return null;
  const prices = packs
    .map(creditUnitPrice)
    .filter((price) => price != null && price > 0);
  return prices.length ? Math.min(...prices) : null;
}

export function subscriptionSavingPercent(plan, packs) {
  const planPrice = creditUnitPrice(plan);
  const packPrice = bestPackUnitPrice(packs);
  if (planPrice == null || packPrice == null || planPrice >= packPrice) return null;
  return Math.max(1, Math.round((1 - planPrice / packPrice) * 100));
}
