// Compact dictionary encoding keeps routing metadata below the 60 KiB budget.
// No prompt strings, token occurrences, reasons or hashes belong in this file.
export function packTemplateRoutes(contracts) {
  const profiles = [], keys = new Map();
  const templates = Object.fromEntries(Object.entries(contracts).map(([id, c]) => {
    const profile = { class: c.class, modelId: c.modelId, slotCount: c.slotCount || 0,
      aspect: c.aspect, duration: c.duration, negativePrompt: c.negativePrompt,
      negativeMax: c.negativeMax, requiredReferences: c.requiredReferences,
      minPhotoDimension: c.minPhotoDimension, photoGuidance: c.photoGuidance };
    const key = JSON.stringify(profile);
    if (!keys.has(key)) { keys.set(key, profiles.length); profiles.push(profile); }
    return [id, keys.get(key)];
  }));
  return { profiles, templates };
}
