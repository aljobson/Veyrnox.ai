// Video templates withdrawn on 2026-11-17 as duplicates (owner request): the prompt and the scene of the
// preview are the same as another template's, so a person who adds the same photo gets the same video.
// Maps each withdrawn public id to the template kept. A withdrawn id leaves the gallery, search, /api/templates,
// /api/presets and the sitemap; the template page redirects its old link to the keeper (duplicateKeeperId).
// Keeper rule: the one in VIDEO_GALLERY_TEMPLATE_IDS, else the most liked, else the shortest id; where the
// pair's landing-wall template is one of them it is kept (event-character-swap).  The records stay in the audit corpus
// (ALL_TEMPLATES, fidelity contracts), so no audit baseline moves.
// /api/templates/<id> and Create deep links keep resolving a withdrawn id on purpose (saved links, past jobs).
// Clusters checked and kept apart (different scene, outfit, car or source clip) are listed in the PR, not here.
export const DUPLICATE_TEMPLATE_KEEPERS = Object.freeze({
  'community-birthday-car-swap': 'community-surprise-birthday-drift',
  'community-club-dj-set': 'community-nightlife-dj-set',
  'community-desert-truck-leap': 'community-truck-jump-reveal',
  'community-dragon-summoner': 'community-dragon-awakening',
  'community-midnight-fridge-feast': 'community-fridge-snack-swap',
  'community-kitchen-snack-heist': 'community-fridge-snack-swap',
  'community-street-style-swap': 'community-street-style-strut',
  'community-kitchen-cleaver-swing': 'community-kitchen-fish-slice',
  'community-kitchen-coffee-swap': 'community-kitchen-duo',
  'community-tactical-gear-montage': 'community-locker-room-swap',
  'community-manor-bridge-blast': 'community-manor-character-recast',
  'who-was-that-business': 'curtain-reveal',
  'rap-takeover': 'event-character-swap',
});

/** The keeper's id when `id` is a withdrawn duplicate (old links included), else null. */
export const duplicateKeeperId = (id) => (Object.hasOwn(DUPLICATE_TEMPLATE_KEEPERS, id) ? DUPLICATE_TEMPLATE_KEEPERS[id] : null);
