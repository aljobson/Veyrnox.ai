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

const monthlyTwin = (id) => id.replace(/-yearly$/, '-monthly');
/** What a yearly plan saves against twelve payments of its monthly twin, from the plan rows alone (no list price). */
export function yearlySaving(plan, plans) {
  if (plan?.billing_interval !== 'year' || !Array.isArray(plans)) return null;
  const monthly = plans.find((p) => p.id === monthlyTwin(plan.id) && p.billing_interval === 'month');
  if (!monthly) return null;
  const full = monthly.price_usd_cents * 12;
  const saved = full - plan.price_usd_cents;
  return saved > 0 ? { amountCents: saved, pct: Math.round((saved / full) * 100) } : null;
}
