// Price tiers for the studio model list. The catalog stays normative for
// price (CLAUDE.md "Money & billing"); this only groups what it already says.
export const TIERS = ['low', 'medium', 'high'];

export const TIER_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

// Splits the given models into thirds by credit price. Equal prices share a
// tier so two models that cost the same never land in different groups.
export function tierById(models) {
  const prices = [...new Set(models.map((m) => m.credits))].sort((a, b) => a - b);
  const third = prices.length / 3;
  const out = new Map();
  for (const m of models) {
    const rank = prices.indexOf(m.credits);
    out.set(m.id, TIERS[Math.min(2, Math.floor(rank / Math.max(third, 1)))]);
  }
  return out;
}

// tier === null shows everything.
export function filterByTier(models, tier) {
  if (!tier) return models;
  const tiers = tierById(models);
  return models.filter((m) => tiers.get(m.id) === tier);
}
