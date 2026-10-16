const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function creditValueRange(credits, packs) {
  if (!Number.isFinite(credits) || credits <= 0 || !Array.isArray(packs)) return null;

  const centsPerCredit = packs
    .filter((pack) => Number.isFinite(pack?.credits)
      && pack.credits > 0
      && Number.isFinite(pack?.price_usd_cents)
      && pack.price_usd_cents >= 0)
    .map((pack) => pack.price_usd_cents / pack.credits);

  if (centsPerCredit.length === 0) return null;

  return {
    minCents: Math.round(credits * Math.min(...centsPerCredit)),
    maxCents: Math.round(credits * Math.max(...centsPerCredit)),
  };
}

export function formatUsdRange(range) {
  if (!range) return null;
  const minimum = usd.format(range.minCents / 100);
  const maximum = usd.format(range.maxCents / 100);
  return range.minCents === range.maxCents ? minimum : `${minimum}–${maximum}`;
}
