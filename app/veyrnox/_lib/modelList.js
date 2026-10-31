// Catalog lists shared by public pages and background work, without page copy or templates.
import { readPublicCatalog } from '../../../lib/publicCatalog.js';
import { MODELS, distinctShelfNames, isShelfModel, kindOf, shelfName } from './tokens.js';

// Catalog ids are lowercase slugs such as `wan-2.5-kie`.
export const MODEL_ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

// Same rule as the landing shelf: only what the picker sells to everyone.
export function shelfModels(rows) {
  const shelf = rows.filter((m) => isShelfModel(m.capabilities));
  return namedModels(shelf);
}

export function namedModels(rows) {
  // Titles head the list and each model's own page, so no two may match.
  const titleOf = distinctShelfNames(rows);
  return rows.map((m) => ({ ...m, kind: kindOf(m.modality), title: titleOf(m) }));
}

// Public pages must remain useful when the live catalog is unavailable (local
// development, a transient database outage, or a missing Worker binding). The
// bundled list deliberately carries fewer facts than the catalog; do not
// invent provider capabilities just to make the fallback look richer.
export function fallbackModels() {
  return MODELS.filter((model) => !model.staged).map((model) => ({
    ...model,
    modality: model.kind,
    capabilities: { inputs: {}, media: {} },
    title: shelfName(model.name),
  }));
}

// `options` reaches readPublicCatalog; the cron passes its own cfg, since
// process.env is not the Worker env outside a request.
export async function listModels(options) {
  try {
    return shelfModels(await readPublicCatalog(options));
  } catch (error) {
    // Explicit options are supplied by trusted background work that must know
    // whether its catalog read failed. Browser pages call with no options and
    // may safely render the bundled public fallback.
    if (options !== undefined) throw error;
    return fallbackModels();
  }
}

// File transformations have reference pages too, without adding editor-only
// products to the prompt-generation directory or exposing unreleased tools.
export async function listModelsForDetails(options) {
  return namedModels((await readPublicCatalog(options)).filter((model) => {
    const caps = model.capabilities || {};
    return isShelfModel(caps) || (!model.gated && caps.outputStems && !caps.edit
      && !caps.inputs?.clips && !caps.inputs?.topic && !caps.inputs?.plan_id);
  }));
}

export async function findModel(id, options) {
  if (typeof id !== 'string' || !MODEL_ID_RE.test(id)) return null;
  return (await listModelsForDetails(options)).find((m) => m.id === id) || null;
}

