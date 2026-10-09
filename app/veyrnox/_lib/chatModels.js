// The model picker's data: cost tiers, the two levels (maker, then model) and the cost filter. Pure, so it is tested without a browser.

export const TIERS = [
  { id: 'low', label: 'Low', dots: 1 },
  { id: 'medium', label: 'Medium', dots: 2 },
  { id: 'high', label: 'High', dots: 3 },
];

/** A reply's base price as a tier: 1 Credit is Low, 2 to 3 Medium, 4 and over High. */
export function tierOf(credits) {
  const n = Number(credits);
  return n >= 4 ? 'high' : n >= 2 ? 'medium' : 'low';
}
export const tierLabel = (id) => TIERS.find((t) => t.id === id)?.label || '';

const ORDER = ['claude', 'chatgpt', 'gemini', 'grok', 'deepseek', 'llama', 'mistral', 'qwen', 'perplexity', 'zhipu'];
const rank = (maker) => { const i = ORDER.indexOf(maker); return i === -1 ? ORDER.length : i; };

/**
 * The first level: makers in a fixed order (unknown ones last), each with its models cheapest first. `tiers` is a Set of tier
 * ids; an empty set keeps every model. `keepId` stays in the list even if the filter would hide it, so the chosen model never
 * disappears from under the person using it. The input is not changed.
 */
export function makerGroups(models, tiers = new Set(), keepId = null) {
  const keep = (m) => tiers.size === 0 || tiers.has(tierOf(m.credits_per_reply)) || m.id === keepId;
  const groups = new Map();
  for (const m of models.filter(keep)) {
    if (!groups.has(m.maker)) groups.set(m.maker, { maker: m.maker, label: m.maker_label, models: [] });
    groups.get(m.maker).models.push(m);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, models: [...g.models].sort((a, b) => a.credits_per_reply - b.credits_per_reply || a.name.localeCompare(b.name)) }))
    .sort((a, b) => rank(a.maker) - rank(b.maker) || a.label.localeCompare(b.label));
}

/** The model a new chat opens on: the cheapest, then by family order, then by name. Undefined if there are none. */
export function defaultModel(models) {
  return [...models].sort((a, b) => a.credits_per_reply - b.credits_per_reply || rank(a.maker) - rank(b.maker) || a.name.localeCompare(b.name))[0];
}
