// Data for the public /models pages and the sitemap. The live catalog is
// authoritative; public pages use the checked-in fallback only when that
// catalog cannot be reached.
import { readPublicCatalog } from '../../../lib/publicCatalog.js';
import { PRESETS } from './templates.js';
import { modelBadges, modelSummary } from './modelSummaries.js';
import { MODELS, distinctShelfNames, isShelfModel, kindOf, modelIdForName, shelfName } from './tokens.js';
import { outputDurationLabel } from './chatMedia.js';
import { audioDurationLabel, sourceDurationLimit } from './modelPricing.js';
import { translator } from '../../../lib/i18n/translate.mjs';

const ENGLISH = translator('en');

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

// Public pages must remain useful when the live catalog is unavailable (local
// development, a transient database outage, or a missing Worker binding). The
// bundled list deliberately carries fewer facts than the catalog; do not
// invent provider capabilities just to make the fallback look richer.
export function fallbackModels() {
  return MODELS.map((model) => ({
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

const MEDIA_LABEL = { image: 'Image', video: 'Video', audio: 'Audio' };

const humanise = (key) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// What the catalog says the model takes, as label/value rows. `t` is a
// translator (lib/i18n/translate.mjs); with none the words are English. Values
// the catalog supplies (aspect ratios, stem names) are data and stay as they are.
export function modelFacts(model, t = ENGLISH) {
  const caps = model.capabilities || {};
  const inputs = caps.inputs || {};
  const modeKey = `model.mode.${model.modality}`;
  const facts = [{ label: t('model.fact.mode'), value: t.messages[modeKey] ? t(modeKey) : String(model.modality || '').replace(/-/g, ' ') }];
  if (model.kind === 'video' && Array.isArray(model.durations) && model.durations.length > 0) {
    const sourceLimit = sourceDurationLimit(model);
    facts.push({ label: t('model.fact.clipLengths'), value: sourceLimit ? t('model.fact.followsSource', { n: sourceLimit })
      : model.durations.map((s) => outputDurationLabel(model, s).replace(/s$/i, ' s')).join(', ') });
  }
  if (model.kind === 'audio') {
    const duration = audioDurationLabel(model);
    if (duration) facts.push({ label: t('model.fact.outputDuration'), value: duration });
    else if (caps.kind === 'speech') facts.push({ label: t('model.fact.outputDuration'), value: t('model.fact.dependsOnText') });
  }
  if (Array.isArray(caps.outputStems)) facts.push({ label: t('model.fact.stems'), value: caps.outputStems.join(', ') });
  if (inputs.prompt) facts.push({ label: t('model.fact.prompt'), value: t('model.fact.textPrompt') });
  for (const [slot, spec] of Object.entries(caps.media || {})) {
    const state = t(spec.required ? 'model.fact.required' : 'model.fact.optional');
    const media = MEDIA_LABEL[slot] ? t(`model.media.${slot}`) : humanise(slot);
    facts.push({ label: t('model.fact.input', { media }), value: spec.maxSeconds ? t('model.fact.upTo', { state, n: spec.maxSeconds }) : state });
  }
  for (const [key, rule] of Object.entries(inputs)) {
    if (rule.type === 'enum' && Array.isArray(rule.values) && rule.values.length > 0) {
      facts.push({ label: t.messages[`model.field.${key}`] ? t(`model.field.${key}`) : humanise(key), value: rule.values.join(', ') });
    }
  }
  return facts;
}

const USE_CASES = {
  video: ['Short cinematic shots', 'Social video concepts', 'Storyboards and visual tests'],
  image: ['Campaign concepts', 'Thumbnails and key art', 'Fast visual exploration'],
  audio: ['Soundtracks and effects', 'Voice and dialogue', 'Audio ideas before production'],
};

/** Plain-language, product-backed content for one model page. */
export function modelDetail(model) {
  if (!model) return null;
  const facts = modelFacts(model);
  const badges = modelBadges({ ...model, kind: model.kind || kindOf(model.modality) });
  const required = facts.filter((fact) => /input$/i.test(fact.label) && /^Required/.test(fact.value));
  const inferredRequired = badges.includes('IMAGE + AUDIO') ? 'image and audio'
    : badges.includes('VIDEO + AUDIO') ? 'video and audio'
      : badges.includes('IMAGE REF') ? 'image'
        : badges.includes('VIDEO REF') ? 'video'
          : null;
  const requiredText = required.length
    ? `Add the required ${required.map((fact) => fact.label.replace(/ input$/i, '').toLowerCase()).join(' and ')}.`
    : inferredRequired ? `Add the required ${inferredRequired}.` : 'Write a clear brief describing the result you want.';
  const kind = model.kind || kindOf(model.modality);
  return {
    summary: modelSummary({ ...model, kind }),
    badges,
    useCases: USE_CASES[kind] || USE_CASES.image,
    steps: [
      { title: 'Set the brief', body: requiredText },
      { title: 'Choose the format', body: kind === 'video' ? 'Choose an available clip length and format.' : 'Choose the format that fits where the result will be used.' },
      { title: 'Check, then generate', body: `Studio shows the exact ${model.credits}-credit starting price before you run it. Failed generations refund automatically.` },
    ],
    faq: [
      { question: `What is ${model.title || model.name} best for?`, answer: modelSummary({ ...model, kind }) },
      { question: 'What will it cost?', answer: `${model.credits} credits at the listed base setting. Studio shows the final total before generation.` },
      { question: 'What happens if it fails?', answer: 'A failed generation refunds its credits automatically and remains visible in your Library.' },
    ],
  };
}

/** Templates wired to this exact model id, not fuzzy name matching. */
export function templatesForModel(modelId, limit = 6) {
  return PRESETS.filter((preset) => modelIdForName(preset.model) === modelId).slice(0, limit);
}
