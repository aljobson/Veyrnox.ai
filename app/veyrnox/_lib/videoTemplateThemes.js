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
      // ADR-0309 amendment 3: listed only while the seedanceLongTemplates runtime key is on.
      'ocean-car-sinking',
    ],
  },
  {
    id: 'DANCE',
    templateIds: [
      'community-street-shuffle-walk', 'community-urban-dance-walk', 'community-skyline-terrace-groove',
      'community-boardwalk-dance-routine', 'community-subway-mascot-dance', 'community-canyon-groove',
      'community-london-gentleman-walk',
      // ADR-0309 amendment 3: listed only while the seedanceLongTemplates runtime key is on.
      'studio-ballerina-turns',
    ],
  },
  {
    id: 'ACTION',
    templateIds: [
      'community-explosive-exit', 'community-mansion-raid-swap', 'community-midnight-forest-run',
      'community-cartoon-puppet-swap', 'seedance-quick-change',
      // ADR-0309 amendment 3: listed only while the seedanceLongTemplates runtime key is on.
      'seedance-rescue-myself', 'ruins-escape-run', 'community-shockwave-horizon-shift', 'seedance-subway-fight', 'rooftop-agent-pursuit', 'seedance-roof-jump', 'community-subway-combat-strike', 'community-parkour-vault-shift', 'freefall', 'sm-brand-new-day', 'office-kitchen', 'seedance-quick-change-2',
    ],
  },
  {
    id: 'COMEDY',
    templateIds: [
      'community-skyline-flamingo-prank', 'community-championship-slap-duel', 'community-dramatic-office-outburst',
      'seedance-anothers-opinion',
      // ADR-0309 amendment 3: listed only while the seedanceLongTemplates runtime key is on.
      'seedance-blocked-light', 'seedance-bunny-taxi', 'holiday-heist-run',
    ],
  },
  // ADR-0309 amendment 3: three themes for the long-prompt templates, listed only while the seedanceLongTemplates runtime key is
  // on. With it off they have no card, so their chips do not show (templateCategories lists only themes with a card).
  {
    id: 'HORROR',
    templateIds: [
      'trick-or-skin', 'theater-ceiling-horror', 'the-wrong-one', 'pizzeria-hide-and-seek', 'thrille', 'fashion-halloween',
      'ghost-makeover', 'pumpkin-guardian', 'enchanted-forest-selfie',
    ],
  },
  {
    id: 'MAGIC',
    templateIds: [
      'community-dragon-rider-encounter', 'community-dragon-awakening', 'dragon-lord', 'curious-garden-journey', 'dandelion-ball',
      'the-crown', 'the-spirit', 'sea-snakes', 'born-from-sand',
    ],
  },
  // Movie-style scenes. MOVIES is a style category id, which a theme may not reuse, so this theme is FILM.
  {
    id: 'FILM',
    templateIds: [
      'noir-film', 'underground-lab-transformation', 'window-explode', 'seedance-glass-cube', 'x-ray-matter', 'game-character-rig',
      'reflection-in-the-mirror',
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
