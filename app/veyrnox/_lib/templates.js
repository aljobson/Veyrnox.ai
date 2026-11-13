// Templates (the /presets gallery): a look pinned to one model, with its own
// prompt, aspect ratio and, where the model needs one, a note of what to
// upload. "Use this template" hands prompt and aspect to the studio
// (landingDraft.js), so the studio's own upload, consent and pricing apply —
// nothing here charges or calls a provider.
//
// `model` is the display name in MODELS (tokens.js), resolved to an id by
// modelIdForName; `credits` must equal that model's 5s price
// (tests/presetLinking.test.mjs). Prices shown come from the live catalog.

import { publishedImageTemplates } from './imageTemplates.js';
import { SOURCE_TEMPLATES } from './sourceTemplates.js';
import { REFERENCE_TEMPLATES } from './referenceTemplates.js';
import { EFFECT_CONCEPT_TEMPLATES } from './effectConceptTemplates.js';
import { EFFECT_THEMES, effectThemeId, themedTemplates } from './effectThemes.js';
import { SHOWCASE_CLIPS } from './showcase.js';
import { isPublishableSourcePromptTemplate } from './sourcePromptAudit.js';
import { publicTemplateId } from './templateIds.js';
import { BROKEN_TEMPLATE_IDS } from './brokenTemplateIds.js';
import {
  HIGGSFIELD_90_WALL_CLIP_KEYS,
} from './sourceTemplateExpansion12.js';

const CATEGORY_ORDER = ['CHRISTMAS', 'YOUR PHOTO', 'KIDS BIRTHDAY', 'CINEMATIC', 'ANIME', 'CARTOONS', 'MOVIES', 'FANTASY', 'REALISTIC', 'FASHION', 'PRODUCTS', 'VFX', 'UGC', 'ADS'];

const DECLARED_WALL_CLIP_KEYS = [
  'wall-warm-portrait', 'wall-film-portrait', 'wall-trick-or-skin',
  'wall-the-wrong-one', 'wall-event-character-swap',
  ...HIGGSFIELD_90_WALL_CLIP_KEYS,
];
// Includes the 300 additional exact community pairs registered in sourceTemplates.js.
const TEMPLATE_CANDIDATES = [...SOURCE_TEMPLATES, ...EFFECT_CONCEPT_TEMPLATES, ...REFERENCE_TEMPLATES];
export const REMOVED_PROMPT_GAP_TEMPLATE_IDS = Object.freeze(SOURCE_TEMPLATES
  .filter((template) => !isPublishableSourcePromptTemplate(template.id))
  .map((template) => template.id));
const REMOVED_PROMPT_GAP_TEMPLATE_ID_SET = new Set(REMOVED_PROMPT_GAP_TEMPLATE_IDS);
const BROKEN_TEMPLATE_ID_SET = new Set(BROKEN_TEMPLATE_IDS);
const withdrawn = (template) => REMOVED_PROMPT_GAP_TEMPLATE_ID_SET.has(template.id) || BROKEN_TEMPLATE_ID_SET.has(publicTemplateId(template.id));

// Source records with an absent or truncated matched prompt remain in the
// audit corpus, but are removed from every public surface and direct route.
// Every remaining runnable recipe stays addressable by id; only recipes with
// a real video preview are listed in the gallery and API.
// Published ids and fields name no source platform: the original id stays only
// in the source records, and an old link's id still resolves (templateById).
const publishable = ({ sourcePlatform: _platform, sourceUrl: _url, ...template }) => ({ ...template, id: publicTemplateId(template.id) });
export const ALL_TEMPLATES = TEMPLATE_CANDIDATES
  .filter((template) => !withdrawn(template))
  .map(publishable);
/** Ids templates were published under before they lost their source name; each redirects to its template. */
export const LEGACY_TEMPLATE_IDS = Object.freeze(TEMPLATE_CANDIDATES
  .filter((template) => !withdrawn(template) && publicTemplateId(template.id) !== template.id)
  .map((template) => template.id));
export const WALL_CLIP_KEYS = DECLARED_WALL_CLIP_KEYS.filter((key) => ALL_TEMPLATES.some((template) => template.clipKey === key));
export const hasTemplateVideo = (preset) => Boolean(preset?.clipKey && SHOWCASE_CLIPS[preset.clipKey]?.video);
export const PRESETS = ALL_TEMPLATES.filter(hasTemplateVideo);
export const WALL_PRESETS = WALL_CLIP_KEYS.map((key) => ALL_TEMPLATES.find((p) => p.clipKey === key)).filter(Boolean);
export const PRESET_CATEGORIES = ['ALL', 'NEW', ...CATEGORY_ORDER.filter((category) => PRESETS.some((p) => p.category === category))];
// Video exports remain stable for legacy clients and generated fidelity data.
// Web discovery reads the gate at request time, including after a cached video list.
export const allPublishedTemplates = () => [...ALL_TEMPLATES, ...publishedImageTemplates()];
export const galleryTemplates = () => [...PRESETS, ...publishedImageTemplates()];
export function galleryCategories() {
  const templates = galleryTemplates();
  return ['ALL', 'NEW', ...CATEGORY_ORDER.filter(category => templates.some(p => p.category === category))];
}
export { QUICK_PRESET_CATEGORIES } from './tokens.js';
export { EFFECT_THEMES, effectThemeId };

// "New" is a flag, not a home category: a new template also sits in its own.
export function templatesIn(category) {
  const templates = galleryTemplates();
  if (category === 'ALL') return templates;
  if (category === 'NEW') return templates.filter((p) => p.isNew);
  return templates.filter((p) => p.category === category);
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
      template.category,
      template.prompt,
      template.needs,
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function templateById(id) {
  const wanted = publicTemplateId(id);
  return allPublishedTemplates().find((p) => p.id === wanted) || null;
}

// Defined in tokens.js so components that only need the link do not pull in
// the whole catalog; re-exported here for callers that import from templates.
export { templateHref } from './tokens.js';
