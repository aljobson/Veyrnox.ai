// Templates (the /presets gallery): a look pinned to one model, with its own
// prompt, aspect ratio and, where the model needs one, a note of what to
// upload. "Use this template" hands prompt and aspect to the studio
// (landingDraft.js), so the studio's own upload, consent and pricing apply —
// nothing here charges or calls a provider.
//
// `model` is the display name in MODELS (tokens.js), resolved to an id by
// modelIdForName; `credits` must equal that model's 5s price
// (tests/presetLinking.test.mjs). Prices shown come from the live catalog.

import { SOURCE_TEMPLATES } from './sourceTemplates.js';
import { REFERENCE_TEMPLATES } from './referenceTemplates.js';
import { EFFECT_CONCEPT_TEMPLATES } from './effectConceptTemplates.js';
import { EFFECT_THEMES, effectThemeId, themedTemplates } from './effectThemes.js';
import { SHOWCASE_CLIPS } from './showcase.js';
import { isPublishableSourcePromptTemplate } from './sourcePromptAudit.js';
import {
  HIGGSFIELD_90_WALL_CLIP_KEYS,
  REPLACED_HIGGSFIELD_CLIP_KEYS,
} from './sourceTemplateExpansion12.js';

const CATEGORY_ORDER = ['YOUR PHOTO', 'KIDS BIRTHDAY', 'CINEMATIC', 'ANIME', 'CARTOONS', 'MOVIES', 'FANTASY', 'REALISTIC', 'FASHION', 'PRODUCTS', 'VFX', 'UGC', 'ADS'];

const LEGACY_WALL_CLIP_KEYS = [
  'wall-product-hero-360',
  'wall-cctv-night',
  'wall-sunset-drift',
  'wall-neon-alley',
  'wall-warm-portrait',
  'wall-film-portrait',
  'wall-talking-head',
  'wall-clean-cutout',
  'wall-trick-or-skin',
  'wall-the-wrong-one',
  'wall-pigeons',
  'wall-mighty-fighter',
  'wall-agamemnon',
  'wall-blue-depth',
  'wall-cyclope',
  'wall-fairytale-castle',
  'wall-infinite-clones',
  'wall-moonwalk',
  'wall-skatedog',
  'wall-windows',
  'wall-behind-the-lens',
  'wall-sticker-peel-reveal',
  'wall-dolphin-surf-ride',
  'wall-event-character-swap',
];
const REPLACED_HIGGSFIELD_CLIP_KEY_SET = new Set(REPLACED_HIGGSFIELD_CLIP_KEYS);
const WALL_CLIP_KEYS = [
  ...LEGACY_WALL_CLIP_KEYS.filter((key) => !REPLACED_HIGGSFIELD_CLIP_KEY_SET.has(key)),
  ...HIGGSFIELD_90_WALL_CLIP_KEYS,
];
const TEMPLATE_CANDIDATES = [...SOURCE_TEMPLATES, ...EFFECT_CONCEPT_TEMPLATES, ...REFERENCE_TEMPLATES];
export const REMOVED_PROMPT_GAP_TEMPLATE_IDS = Object.freeze(TEMPLATE_CANDIDATES
  .filter((template) => !isPublishableSourcePromptTemplate(template.id))
  .map((template) => template.id));
const REMOVED_PROMPT_GAP_TEMPLATE_ID_SET = new Set(REMOVED_PROMPT_GAP_TEMPLATE_IDS);

// Source records with an absent or truncated matched prompt remain in the
// audit corpus, but are removed from every public surface and direct route.
// Every remaining runnable recipe stays addressable by id; only recipes with
// a real video preview are listed in the gallery and API.
export const ALL_TEMPLATES = TEMPLATE_CANDIDATES
  .filter((template) => !REMOVED_PROMPT_GAP_TEMPLATE_ID_SET.has(template.id));
export const hasTemplateVideo = (preset) => Boolean(preset?.clipKey && SHOWCASE_CLIPS[preset.clipKey]?.video);
export const PRESETS = ALL_TEMPLATES.filter(hasTemplateVideo);
export const WALL_PRESETS = WALL_CLIP_KEYS.map((key) => ALL_TEMPLATES.find((p) => p.clipKey === key)).filter(Boolean);
export const PRESET_CATEGORIES = ['ALL', 'NEW', ...CATEGORY_ORDER.filter((category) => PRESETS.some((p) => p.category === category))];
// The first filter row is deliberately concise; the gallery can disclose the
// complete category catalog in place without hiding choices in a scroll rail.
export const QUICK_PRESET_CATEGORIES = ['ALL', 'NEW', 'POPULAR', 'YOUR PHOTO', 'PRODUCTS', 'STORIES'];
export { EFFECT_THEMES, effectThemeId };

// "New" is a flag, not a home category: a new template also sits in its own.
export function templatesIn(category) {
  if (category === 'ALL') return PRESETS;
  if (category === 'NEW') return PRESETS.filter((p) => p.isNew);
  return PRESETS.filter((p) => p.category === category);
}

export function templatesInTheme(theme) {
  return themedTemplates(theme, PRESETS);
}

// Template search stays local: the gallery is a small static list and every
// useful matching field is already in the browser. Keep this separate from the
// site-wide search so choosing a category and narrowing within it compose.
export function searchTemplates(templates, query) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) return templates;
  const terms = needle.split(/\s+/);
  return templates.filter((template) => {
    const haystack = [
      template.name,
      template.id.replaceAll('-', ' '),
      template.model,
      template.sourceModel,
      template.sourcePlatform,
      template.category,
      template.prompt,
      template.needs,
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function templateById(id) {
  return ALL_TEMPLATES.find((p) => p.id === id) || null;
}

/** The template's own page, where its prompt and inputs are shown before use. */
export function templateHref(preset) {
  return `/presets/${encodeURIComponent(preset.id)}`;
}
