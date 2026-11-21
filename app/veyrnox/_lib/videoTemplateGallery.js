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

// Hidden 2026-11-18 (owner): 76 swap recipes ("Replace X in the video with <<<image_1>>>") were listed here, but the server refuses
// them with template_blocked before any charge (lib/templateFidelity.js, swapNeedsSourceVideo). They need the template's own source
// clip, which only the swap path (ADR-0351, off) can supply. Five of the 76 (community-coastal-driver-swap, -dinner-party-recast,
// -forest-umbrella-shift, -stage-dance-sync, -urban-stride) slipped past the guard until it learned "replaced by <photo>",
// "in the video" and a leading "Swap". They stay reachable by direct link. Re-list one only once its swap is on.
// tests/videoTemplateCap.test.mjs pins that no listed template is such a recipe.
// Hidden 2026-11-20 (owner, option B): 45 templates whose exact prompt is over the Kling 3.0 cap (KLING_V3_PROMPT_MAX, 2,500 characters)
// left the list. fal rejects such a prompt and the job is refunded, so the server now refuses it before any charge. Templates run their exact
// prompt, never a trimmed one. They stay reachable by direct link and return once the cap is raised or a route takes the length:
// impact, cake-in-the-fridge, trick-or-skin, seedance-rescue-myself, ruins-escape-run, born-from-sand, community-shockwave-horizon-shift, community-dragon-rider-encounter, community-dragon-awakening, seedance-glass-cube, theater-ceiling-horror, ghost-makeover, pumpkin-guardian, seedance-blocked-light, curious-garden-journey, the-wrong-one, holiday-heist-run, enchanted-forest-selfie, fashion-halloween, pizzeria-hide-and-seek, seedance-subway-fight, x-ray-matter, reflection-in-the-mirror, dandelion-ball, rooftop-agent-pursuit, game-character-rig, sm-brand-new-day, jellyfish-airlines, seedance-roof-jump, window-explode, ocean-car-sinking, seedance-bunny-taxi, the-crown, office-kitchen, dragon-lord, studio-ballerina-turns, community-subway-combat-strike, noir-film, the-spirit, underground-lab-transformation, freefall, sea-snakes, seedance-quick-change-2, community-parkour-vault-shift, thrille.
// Hidden 2026-11-21 (owner, "tidy the cards"): community-midnight-supercar-refuel and community-supercar-night-fueling, near-duplicates
// of community-supercar-midnight-refuel (same night refuel at a pump; the kept one shows the person from the first frame, has the
// clearest poster and the full identity prompt). Nothing is deleted and their links still resolve. To restore one, put its id back
// in this list; its theme (CARS) is still on file in videoTemplateThemes.js.
// Hidden 2026-11-21 (owner): community-supercar-midnight-refuel. Its prompt never describes the car or the refuel, so the photo route
// cannot produce the scene, and two paid swap tests failed (original man left in the wide shots; then the scene was lost). Link still resolves.
// Hidden 2026-11-21 (owner, "only templates which work"): community-skyline-flamingo-prank, community-drive-thru-dialogue, community-skyline-terrace-groove,
// community-subway-mascot-dance and community-cartoon-puppet-swap. Their short prompts depend on a source clip that image-to-video never receives. Links still resolve.
// Swap templates proven before listing (owner, 2026-11-21, "only have templates which work"; ADR-0351 amendment 20). Each passed a paid
// Kling O1 run with a real photo and a shot-by-shot comparison with its source clip. They run on the swap path, which supplies that clip.
// An id joins this list only after the same test. tests/videoTemplateCap.test.mjs requires each one to be a registered swap clip.
export const TESTED_SWAP_GALLERY_TEMPLATE_IDS = Object.freeze([
  'community-action-hero-strut', 'community-alleyway-identity-swap', 'community-apocalypse-lounge',
  'community-arctic-water-pour', 'community-ballroom-dance-switch', 'community-ballroom-tuxedo-shift',
  'community-beachside-dance', 'community-black-dress-walk', 'community-blonde-sport-set',
  'community-bottle-topple-kick', 'community-brooklyn-bridge-groove', 'community-burgundy-stride',
  'community-cardigan-groove', 'community-cash-burner', 'community-ceiling-fan-transition',
  'community-chandelier-lounge-performance', 'community-city-plaza-dance', 'community-costume-basketball-swap',
  'community-currency-phone-call', 'community-equestrian-sunset-gallop', 'community-extreme-pizza-freefall',
  'community-festival-stage-presence', 'community-folding-ancient-city', 'community-formal-dance-swap',
  'community-gentleman-branch-chop', 'community-golden-gown-walk', 'community-identity-swap',
  'community-kitchen-dance-swap', 'community-marble-hallway-pose', 'community-marble-vanity-mirror',
  'community-metropolitan-crosswalk', 'community-midnight-city-shuffle', 'community-minimalist-cafe-swap',
  'community-mirror-flip-transition', 'community-natural-face-swap', 'community-neon-selfie-swap',
  'community-nightlife-dj-set', 'community-noir-espionage-flow', 'community-parkside-dance-reimagined',
  'community-party-dancer-swap', 'community-private-jet-swap', 'community-retro-housewife-dance',
  'community-retro-tracksuit-groove', 'community-skyline-rhythm-walk', 'community-skyscraper-ledge-spin',
  'community-sour-drink-reaction', 'community-street-dance-recast', 'community-street-dance-swap',
  'community-street-dancer-recast', 'community-street-style-strut', 'community-suit-walk',
]);

export const VIDEO_GALLERY_TEMPLATE_IDS = Object.freeze([
  ...TESTED_SWAP_GALLERY_TEMPLATE_IDS,
  'community-explosive-exit',
  'community-mansion-raid-swap', 'animal-pov-to-the-club',
  'car-sky-fall', 'desert-rider', 'community-pet-affection-reveal',
  'seedance-anothers-opinion',
  'seedance-quick-change', 'community-championship-slap-duel',
  'community-truck-window-confrontation', 'community-street-shuffle-walk',
  'community-urban-dance-walk',
  'community-london-gentleman-walk', 'community-synchronized-pet-portrait', 'community-dramatic-office-outburst',
  'community-midnight-forest-run', 'community-midnight-sports-drive', 'community-boardwalk-dance-routine',
  'community-modern-listing-dolly',
  'community-canyon-groove',
]);

// Long-prompt photo templates (ADR-0309 amendment 3): 42 of the 45 hidden on 2026-11-20 above, whose exact bound prompt (2,501 to
// 20,000 characters) runs on the kie Seedance 2 offer with the photo as its one reference picture. Listed only while the
// seedanceLongTemplates runtime key is on (lib/seedanceLongTemplates.js, templates.js galleryVideoPresets); impact and
// cake-in-the-fridge stay out (over 20,000), and jellyfish-airlines (kie's copyright filter refused it in the 2026-11-20
// probe, nothing charged; runnable by link). They count toward VIDEO_TEMPLATE_CAP when listed.
export const LONG_PROMPT_GALLERY_TEMPLATE_IDS = Object.freeze([
  'trick-or-skin', 'seedance-rescue-myself', 'ruins-escape-run', 'born-from-sand', 'community-shockwave-horizon-shift',
  'community-dragon-rider-encounter', 'community-dragon-awakening', 'seedance-glass-cube', 'theater-ceiling-horror',
  'ghost-makeover', 'pumpkin-guardian', 'seedance-blocked-light', 'curious-garden-journey', 'the-wrong-one', 'holiday-heist-run',
  'enchanted-forest-selfie', 'fashion-halloween', 'pizzeria-hide-and-seek', 'seedance-subway-fight', 'x-ray-matter',
  'reflection-in-the-mirror', 'dandelion-ball', 'rooftop-agent-pursuit', 'game-character-rig', 'sm-brand-new-day',
  'seedance-roof-jump', 'window-explode', 'ocean-car-sinking', 'seedance-bunny-taxi', 'the-crown',
  'office-kitchen', 'dragon-lord', 'studio-ballerina-turns', 'community-subway-combat-strike', 'noir-film', 'the-spirit',
  'underground-lab-transformation', 'freefall', 'sea-snakes', 'seedance-quick-change-2', 'community-parkour-vault-shift',
  'thrille',
]);
