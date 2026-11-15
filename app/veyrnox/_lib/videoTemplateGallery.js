// The video template gallery, capped at 150 (owner decisions: 100 on 2026-11-14, raised to 150 on 2026-11-15).
// Every listed prompt is English (owner, 2026-11-15; scripts/lib/english-prompt.mjs): nine non-English templates
// left the list then, still reachable by direct link.
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

export const VIDEO_TEMPLATE_CAP = 150;

export const VIDEO_GALLERY_TEMPLATE_IDS = Object.freeze([
  'jellyfish-airlines', 'dandelion-ball', 'sm-brand-new-day', 'trick-or-skin',
  'the-wrong-one', 'enchanted-forest-selfie', 'community-action-hero-strut', 'community-ballroom-dance-switch',
  'pizzeria-hide-and-seek', 'theater-ceiling-horror', 'studio-ballerina-turns', 'reflection-in-the-mirror',
  'pumpkin-guardian', 'fashion-halloween', 'thrille', 'ghost-makeover',
  'community-fur-coat-walk', 'community-action-hero-walk', 'community-midnight-fridge-feast', 'community-riverside-boat-slap',
  'community-pigeon-head-swap', 'community-midnight-supercar-refuel', 'community-kitchen-dance-swap', 'community-cash-burner',
  'community-explosive-exit', 'community-window-snacker-swap', 'community-dinner-party-recast',
  'community-mansion-raid-swap', 'community-gallop-ride', 'community-nightclub-dj-set',
  'community-bottle-topple-kick', 'community-soccer-character-swap', 'community-cosmetic-sky-drop', 'ocean-car-sinking',
  'office-kitchen', 'animal-pov-to-the-club', 'car-sky-fall', 'underground-lab-transformation',
  'the-spirit', 'the-crown', 'dragon-lord', 'noir-film',
  'desert-rider', 'impact', 'ruins-escape-run', 'curious-garden-journey',
  'born-from-sand', 'freefall',   'x-ray-matter', 'sea-snakes', 'rooftop-agent-pursuit', 'community-pet-affection-reveal',
  'window-explode', 'seedance-bunny-taxi', 'seedance-blocked-light', 'seedance-anothers-opinion',
  'seedance-popcorn-eruption', 'seedance-rescue-myself', 'seedance-quick-change-2', 'seedance-quick-change',
  'seedance-roof-jump', 'seedance-glass-cube', 'seedance-subway-fight', 'cake-in-the-fridge',
  'game-character-rig', 'holiday-heist-run',
  // Added 2026-11-15: 30 top-liked Higgsfield single-photo templates (scripts/import-higgsfield-photo-30.mjs).
  'community-dramatic-fire-walk', 'community-beachside-dance', 'community-metropolitan-crosswalk', 'community-nightlife-dj-set',
  'community-midnight-city-shuffle', 'community-supercar-flex', 'community-retro-tracksuit-groove',
  'community-blonde-sport-set', 'community-street-style-strut', 'community-shoreline-gallop-swap', 'community-dragon-awakening',
  'community-restaurant-character-recast', 'community-skyline-flamingo-prank', 'community-championship-slap-duel',
  'community-industrial-street-flow', 'community-urban-stride', 'community-action-hero-swap', 'community-supercar-night-fueling',
  'community-chauffeur-arrival-swap', 'community-coastal-character-swap',   'community-extreme-pizza-freefall', 'community-truck-window-confrontation', 'community-kitchen-fish-slice',
  'community-urban-dance-recast', 'community-ballroom-tuxedo-shift',
  // Added 2026-11-15 (batch 2): 59 English single-photo Higgsfield templates (scripts/import-higgsfield-photo-59.mjs).
  'community-currency-phone-call', 'community-window-dog', 'community-subway-combat-strike', 'community-street-shuffle-walk',
  'community-purple-suit-slam', 'community-highway-delivery-reveal', 'community-delivery-van-loop', 'community-supercar-midnight-refuel',
  'community-bus-chase-sprint', 'community-drive-thru-dialogue', 'community-highway-vehicle-swap', 'community-urban-dance-walk',
  'community-dust-storm-escape', 'community-fridge-snack-swap', 'community-city-plaza-dance', 'community-cliffside-character-swap',
  'community-skyline-terrace-groove', 'community-equestrian-sunset-gallop', 'community-illustration-street-stride', 'community-london-gentleman-walk',
  'community-cinematic-actor-swap', 'community-industrial-cosplay-swap', 'community-formal-swagger', 'community-private-jet-swap',
  'community-character-recast', 'community-urban-character-swap', 'community-dragon-rider-encounter', 'community-forest-umbrella-shift',
  'community-street-confrontation-swap', 'community-victory-dance-shift', 'community-synchronized-pet-portrait', 'community-dramatic-office-outburst',
  'community-times-square-stage', 'community-midnight-forest-run', 'community-coastal-driver-swap', 'community-midnight-sports-drive',
  'community-shockwave-horizon-shift', 'community-street-dancer-recast', 'community-boardwalk-dance-routine', 'community-face-swap',
  'community-criminal-standoff-montage', 'community-strongman-deadlift-swap', 'community-studio-blast', 'community-subway-mascot-dance',
  'community-laundry-swap', 'community-parkour-vault-shift', 'community-corporate-icon-swap', 'community-rustic-deck-flip',
  'community-stage-dance-sync', 'community-officer-traffic-stop', 'community-cartoon-puppet-swap', 'community-modern-listing-dolly',
  'community-arctic-water-pour', 'community-sour-drink-reaction', 'community-canyon-groove', 'community-redlight-club-sing',
  'community-couch-blast', 'community-station-dance-move', 'community-bubbly-morning-ritual',
]);
