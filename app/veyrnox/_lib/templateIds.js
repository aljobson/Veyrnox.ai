// Public template ids name no source platform. Source records (prompts, audit,
// provenance) stay keyed by their original id; this is the one place the two
// are related, and the mapping is one-way: strip the platform word.
const SOURCE_NAME_IN_ID = /-(?:syntx|higgs)(?=-)/;

/**
 * The id a template is published under.
 * @param {string} id
 * @returns {string}
 */
export function publicTemplateId(id) {
  return typeof id === 'string' ? id.replace(SOURCE_NAME_IN_ID, '') : id;
}

/**
 * Index a record table by public id as well as by its own keys, so lookups
 * work with either the published id or an old link's id.
 * @template T
 * @param {Record<string, T>} records
 * @returns {(id: string) => T | undefined}
 */
export function recordLookup(records) {
  const byPublicId = new Map(Object.keys(records).map((key) => [publicTemplateId(key), key]));
  return (id) => records[id] ?? records[byPublicId.get(id)];
}
