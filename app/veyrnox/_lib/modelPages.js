// Data for the public /models pages and the sitemap. Every fact shown is
// read from the live catalog (lib/publicCatalog.js); nothing here sets a
// price or describes a model in words the catalog does not hold.
import { readPublicCatalog } from '../../../lib/publicCatalog.js';
import { isShelfModel, kindOf, shelfName } from './tokens.js';

// Catalog ids are lowercase slugs such as `wan-2.5-kie`.
export const MODEL_ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

// Same rule as the landing shelf: only what the picker sells to everyone.
export function shelfModels(rows) {
  return rows
    .filter((m) => isShelfModel(m.capabilities))
    .map((m) => ({ ...m, kind: kindOf(m.modality), title: shelfName(m.name) }));
}

export async function listModels() {
  return shelfModels(await readPublicCatalog());
}

export async function findModel(id) {
  if (typeof id !== 'string' || !MODEL_ID_RE.test(id)) return null;
  return (await listModels()).find((m) => m.id === id) || null;
}

const MEDIA_LABEL = { image: 'Image', video: 'Video', audio: 'Audio' };

const humanise = (key) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// What the catalog says the model takes, as label/value rows.
export function modelFacts(model) {
  const caps = model.capabilities || {};
  const inputs = caps.inputs || {};
  const facts = [{ label: 'Mode', value: String(model.modality || '').replace(/-/g, ' ') }];
  if (model.kind === 'video' && Array.isArray(model.durations) && model.durations.length > 0) {
    facts.push({ label: 'Clip lengths', value: model.durations.map((s) => `${s} s`).join(', ') });
  }
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
