// Ranking for the site search overlay. Plain module, no JSX, so the unit
// test can import it directly.
//
// Everything this site contains — routes, catalog rows, presets, FAQ
// answers — fits in memory, so search is a scored scan, not a service.

// Cap per group so a 30-row catalog cannot bury the four pages a visitor
// was actually looking for.
export const MAX_PER_GROUP = 6;

// Shortest query worth scoring. One character matches nearly everything.
export const MIN_QUERY = 2;

function scoreField(haystack, needle) {
  const h = String(haystack || '').toLowerCase();
  const i = h.indexOf(needle);
  if (i < 0) return 0;
  // A prefix hit beats a mid-word hit, and a hit in a short field beats the
  // same hit buried in a long paragraph.
  return (i === 0 ? 3 : 1) + 1 / (h.length + 1);
}

/**
 * Rank `items` against `query`.
 *
 * @param {Array<{group: string, title: string, detail?: string, href: string}>} items
 * @param {string} query
 * @returns {Array<object>} best first, at most MAX_PER_GROUP per group
 */
export function searchIndex(items, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (needle.length < MIN_QUERY) return [];

  const scored = [];
  for (const item of items) {
    const score =
      scoreField(item.title, needle) * 2 +
      scoreField(item.detail, needle) +
      scoreField(item.group, needle) * 0.5;
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const perGroup = new Map();
  const out = [];
  for (const { item } of scored) {
    const n = perGroup.get(item.group) || 0;
    if (n >= MAX_PER_GROUP) continue;
    perGroup.set(item.group, n + 1);
    out.push(item);
  }
  return out;
}
