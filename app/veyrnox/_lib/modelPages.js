// Data for the public /models pages and the sitemap. Every fact shown is
// read from the live catalog (lib/publicCatalog.js); nothing here sets a
// price or describes a model in words the catalog does not hold.
import { readPublicCatalog } from '../../../lib/publicCatalog.js';
import { isShelfModel, kindOf, distinctShelfNames } from './tokens.js';
import { outputDurationLabel } from './chatMedia.js';
import { audioDurationLabel, sourceDurationLimit } from './modelPricing.js';

// Catalog ids are lowercase slugs such as `wan-2.5-kie`.
export const MODEL_ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

// Same rule as the landing shelf: only what the picker sells to everyone.
export function shelfModels(rows) {
  const shelf = rows.filter((m) => isShelfModel(m.capabilities));
  return namedModels(shelf);
}

function namedModels(rows) {
  // Titles head the list and each model's own page, so no two may match.
  const titleOf = distinctShelfNames(rows);
  return rows.map((m) => ({ ...m, kind: kindOf(m.modality), title: titleOf(m) }));
}

// `options` reaches readPublicCatalog; the cron passes its own cfg, since
// process.env is not the Worker env outside a request.
export async function listModels(options) {
  return shelfModels(await readPublicCatalog(options));
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

const MEDIA_LABEL = { image: 'Image', video: 'Video', audio: 'Audio' };

const humanise = (key) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// What the catalog says the model takes, as label/value rows.
export function modelFacts(model) {
  const caps = model.capabilities || {};
  const inputs = caps.inputs || {};
  const facts = [{ label: 'Mode', value: String(model.modality || '').replace(/-/g, ' ') }];
  if (model.kind === 'video' && Array.isArray(model.durations) && model.durations.length > 0) {
    const sourceLimit = sourceDurationLimit(model);
    facts.push({ label: 'Clip lengths', value: sourceLimit ? `Follows source duration (up to ${sourceLimit} s)`
      : model.durations.map((s) => outputDurationLabel(model, s).replace(/s$/i, ' s')).join(', ') });
  }
  if (model.kind === 'audio') {
    const duration = audioDurationLabel(model);
    if (duration) facts.push({ label: 'Output duration', value: duration });
    else if (caps.kind === 'speech') facts.push({ label: 'Output duration', value: 'Depends on text and voice' });
  }
  if (Array.isArray(caps.outputStems)) facts.push({ label: 'Output stems', value: caps.outputStems.join(', ') });
  if (inputs.prompt) facts.push({ label: 'Prompt', value: 'Text prompt' });
  for (const [slot, spec] of Object.entries(caps.media || {})) {
    const limit = spec.maxSeconds ? `, up to ${spec.maxSeconds} s` : '';
    facts.push({ label: `${MEDIA_LABEL[slot] || humanise(slot)} input`, value: `${spec.required ? 'Required' : 'Optional'}${limit}` });
  }
  for (const [key, rule] of Object.entries(inputs)) {
    if (rule.type === 'enum' && Array.isArray(rule.values) && rule.values.length > 0) {
      facts.push({ label: humanise(key), value: rule.values.join(', ') });
    }
  }
  return facts;
}
