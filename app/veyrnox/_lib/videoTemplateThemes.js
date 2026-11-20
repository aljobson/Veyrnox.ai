// Themes for the listed video templates (owner, 2026-11-20): the /presets gallery and Explore on /app filter by these.
// The template's own `category` (CINEMATIC, REALISTIC, ...) is a style tag from its source and says little about what the
// clip is, so the web card list (lib/clientTemplates.js) files each listed video template under its theme instead.
//
// This is data: a template that returns to VIDEO_GALLERY_TEMPLATE_IDS (videoTemplateGallery.js) gets a line here, in an
// existing theme or a new one, and its chip appears once it has a template. tests/videoTemplateThemes.test.mjs fails while
// a listed template has no theme, so none can slip back in unfiled. A theme's label is `presets.cat.<id>` in every locale.
// Theme ids must not reuse a style category id (templates.js CATEGORY_ORDER) or an image template category.
export const VIDEO_TEMPLATE_THEMES = Object.freeze([
  {
    id: 'CARS',
    templateIds: [
      'community-midnight-supercar-refuel', 'community-supercar-night-fueling', 'community-supercar-midnight-refuel',
      'community-midnight-sports-drive', 'car-sky-fall', 'desert-rider', 'community-drive-thru-dialogue',
      'community-truck-window-confrontation',
    ],
  },
  {
    id: 'DANCE',
    templateIds: [
      'community-street-shuffle-walk', 'community-urban-dance-walk', 'community-skyline-terrace-groove',
      'community-boardwalk-dance-routine', 'community-subway-mascot-dance', 'community-canyon-groove',
      'community-london-gentleman-walk',
    ],
  },
  {
    id: 'ACTION',
    templateIds: [
      'community-explosive-exit', 'community-mansion-raid-swap', 'community-midnight-forest-run',
      'community-cartoon-puppet-swap', 'seedance-quick-change',
    ],
  },
  {
    id: 'COMEDY',
    templateIds: [
      'community-skyline-flamingo-prank', 'community-championship-slap-duel', 'community-dramatic-office-outburst',
      'seedance-anothers-opinion',
    ],
  },
  {
    id: 'ANIMALS',
    templateIds: ['animal-pov-to-the-club', 'community-pet-affection-reveal', 'community-synchronized-pet-portrait'],
  },
  // One template today (a room, no person), which fits none of the people themes; listing-style templates join it.
  { id: 'PROPERTY', templateIds: ['community-modern-listing-dolly'] },
]);

/** Theme ids in the order their chips show. */
export const VIDEO_THEME_IDS = Object.freeze(VIDEO_TEMPLATE_THEMES.map((theme) => theme.id));

const THEME_BY_TEMPLATE = new Map(VIDEO_TEMPLATE_THEMES.flatMap((theme) => theme.templateIds.map((id) => [id, theme.id])));

/** The theme id a video template is filed under, or null when it has none. */
export function videoTemplateTheme(templateId) {
  return THEME_BY_TEMPLATE.get(templateId) ?? null;
}
