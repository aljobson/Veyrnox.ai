// Catalog drift checks (ADR-0107): a translation must carry every key of the
// English source, the same {slots}, and no empty or untouched-key values.

const SLOT = /\{([a-zA-Z0-9_]+)\}/g;

function slotsOf(text) {
  return [...String(text).matchAll(SLOT)].map((m) => m[1]).sort();
}

/** Problems in `catalog` measured against the English `source`; [] when clean. */
export function checkCatalog(source, catalog, code) {
  const problems = [];
  for (const key of Object.keys(source)) {
    const value = catalog[key];
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`${code}: missing or empty "${key}"`);
      continue;
    }
    if (slotsOf(value).join() !== slotsOf(source[key]).join()) {
      problems.push(`${code}: "${key}" slots ${JSON.stringify(slotsOf(value))} differ from source ${JSON.stringify(slotsOf(source[key]))}`);
    }
    if (value === key) problems.push(`${code}: "${key}" holds its own key`);
  }
  for (const key of Object.keys(catalog)) {
    if (!(key in source)) problems.push(`${code}: unknown key "${key}"`);
  }
  return problems;
}
