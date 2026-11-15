// The video template gallery, capped at 100 (owner decision, 2026-11-14).
//
// Only templates that really run from the person's own photo are listed: their fidelity contract binds every
// photo the prompt cites (class "bound", lib/templateFidelityContracts.json). The prompt writes the photo as @image1
// or <<<image_1>>>. Audit of 2026-11-15: 73 of the 795 preview-backed templates are bound; three of those are left
// out because their prompt asks for more photos than the one slot takes (community-spinning-wardrobe-swap,
// community-sunlit-bedroom-dance, community-supercar-driver-swap). 30 more were imported on 2026-11-15 to reach 100
// (docs/product/source-audit/higgsfield-photo-30-2026-11-15.json). Templates that need @video, or photos their
// model has no slot for, stay hidden until a route can take them. Hidden templates leave the gallery, search,
// /api/templates, /api/presets and the sitemap; their direct links still resolve (templateById reads ALL_TEMPLATES).
// tests/videoTemplateCap.test.mjs pins the cap and the rule.

export const VIDEO_TEMPLATE_CAP = 100;

export const VIDEO_GALLERY_TEMPLATE_IDS = Object.freeze([
  'jellyfish-airlines', 'dandelion-ball', 'sm-brand-new-day', 'trick-or-skin',
  'the-wrong-one', 'enchanted-forest-selfie', 'community-action-hero-strut', 'community-ballroom-dance-switch',
  'pizzeria-hide-and-seek', 'theater-ceiling-horror', 'studio-ballerina-turns', 'reflection-in-the-mirror',
  'pumpkin-guardian', 'fashion-halloween', 'thrille', 'ghost-makeover',
  'community-fur-coat-walk', 'community-action-hero-walk', 'community-midnight-fridge-feast', 'community-riverside-boat-slap',
  'community-pigeon-head-swap', 'community-midnight-supercar-refuel', 'community-kitchen-dance-swap', 'community-cash-burner',
  'community-folk-dance-swap', 'community-explosive-exit', 'community-window-snacker-swap', 'community-dinner-party-recast',
  'community-mansion-raid-swap', 'community-gallop-ride', 'community-snack-weight-check', 'community-nightclub-dj-set',
  'community-bottle-topple-kick', 'community-soccer-character-swap', 'community-cosmetic-sky-drop', 'ocean-car-sinking',
  'office-kitchen', 'animal-pov-to-the-club', 'car-sky-fall', 'underground-lab-transformation',
  'the-spirit', 'the-crown', 'dragon-lord', 'noir-film',
  'desert-rider', 'impact', 'ruins-escape-run', 'curious-garden-journey',
  'born-from-sand', 'freefall', 'dont-touch-the-braids', 'last-supper',
  'x-ray-matter', 'sea-snakes', 'rooftop-agent-pursuit', 'community-pet-affection-reveal',
  'window-explode', 'seedance-bunny-taxi', 'seedance-blocked-light', 'seedance-anothers-opinion',
  'seedance-popcorn-eruption', 'seedance-rescue-myself', 'seedance-quick-change-2', 'seedance-quick-change',
  'seedance-roof-jump', 'seedance-glass-cube', 'seedance-subway-fight', 'cake-in-the-fridge',
  'game-character-rig', 'holiday-heist-run',
  // Added 2026-11-15: 30 top-liked Higgsfield single-photo templates (scripts/import-higgsfield-photo-30.mjs).
  'community-dramatic-fire-walk', 'community-beachside-dance', 'community-metropolitan-crosswalk', 'community-nightlife-dj-set',
  'community-pigeon-recast', 'community-midnight-city-shuffle', 'community-supercar-flex', 'community-retro-tracksuit-groove',
  'community-blonde-sport-set', 'community-street-style-strut', 'community-shoreline-gallop-swap', 'community-dragon-awakening',
  'community-restaurant-character-recast', 'community-skyline-flamingo-prank', 'community-stage-performer-swap', 'community-championship-slap-duel',
  'community-industrial-street-flow', 'community-urban-stride', 'community-action-hero-swap', 'community-supercar-night-fueling',
  'community-chauffeur-arrival-swap', 'community-kitchen-juggling-swap', 'community-coastal-character-swap', 'community-kitten-holiday-dance',
  'community-bipedal-cat-stroll', 'community-extreme-pizza-freefall', 'community-truck-window-confrontation', 'community-kitchen-fish-slice',
  'community-urban-dance-recast', 'community-ballroom-tuxedo-shift',
]);
