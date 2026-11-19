// Prices are never computed here: the catalog and the SQL quote own them (CLAUDE.md, Money & billing).
export function reconcileMusicDuration(value, { min = 10, max = 60 } = {}) {
  return Math.min(max, Math.max(min, value));
}
