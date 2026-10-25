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
import { EFFECT_CONCEPT_TEMPLATES } from './effectConceptTemplates.js';
import { EFFECT_THEMES, effectThemeId, themedTemplates } from './effectThemes.js';
import { SHOWCASE_CLIPS } from './showcase.js';

const CATEGORY_ORDER = ['YOUR PHOTO', 'KIDS BIRTHDAY', 'CINEMATIC', 'ANIME', 'CARTOONS', 'MOVIES', 'FANTASY', 'REALISTIC', 'FASHION', 'PRODUCTS', 'VFX', 'UGC', 'ADS'];

const WALL_CLIP_KEYS = [
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
// The public library includes every runnable Veyrnox recipe. The source
// templates have owned local preview media; effect concepts use an original
// generated treatment until a preview is ready, but remain searchable and
// usable on both web and mobile.
export const PRESETS = [...SOURCE_TEMPLATES, ...EFFECT_CONCEPT_TEMPLATES];
export const WALL_PRESETS = WALL_CLIP_KEYS.map((key) => SOURCE_TEMPLATES.find((p) => p.clipKey === key)).filter(Boolean);
export const ALL_TEMPLATES = PRESETS;
// Only advertise recipes with an actual video preview in the visual gallery.
export const hasTemplateVideo = (preset) => Boolean(preset?.clipKey && SHOWCASE_CLIPS[preset.clipKey]?.video);
export const PRESET_CATEGORIES = ['ALL', 'NEW', ...CATEGORY_ORDER.filter((category) => PRESETS.some((p) => p.category === category))];
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
