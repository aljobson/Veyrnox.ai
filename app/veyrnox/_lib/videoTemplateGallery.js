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

// Hidden 2026-11-18 (owner): 71 swap recipes ("Replace X in the video with <<<image_1>>>") were listed here but the server refuses
// them with template_blocked before any charge (lib/templateFidelity.js, swapNeedsSourceVideo). They need the template's own
// source clip, which only the swap path (ADR-0351, off) can supply. They stay reachable by direct link. Re-list a template here
// only once its swap is on. tests/videoTemplateCap.test.mjs pins that no listed template is such a recipe.
export const VIDEO_GALLERY_TEMPLATE_IDS = Object.freeze([
  'jellyfish-airlines', 'dandelion-ball', 'sm-brand-new-day', 'trick-or-skin',
  'the-wrong-one', 'enchanted-forest-selfie', 'pizzeria-hide-and-seek', 'theater-ceiling-horror',
  'studio-ballerina-turns', 'reflection-in-the-mirror', 'pumpkin-guardian', 'fashion-halloween',
  'thrille', 'ghost-makeover', 'community-midnight-supercar-refuel', 'community-explosive-exit',
  'community-dinner-party-recast', 'community-mansion-raid-swap', 'ocean-car-sinking', 'office-kitchen',
  'animal-pov-to-the-club', 'car-sky-fall', 'underground-lab-transformation', 'the-spirit',
  'the-crown', 'dragon-lord', 'noir-film', 'desert-rider',
  'impact', 'ruins-escape-run', 'curious-garden-journey', 'born-from-sand',
  'freefall', 'x-ray-matter', 'sea-snakes', 'rooftop-agent-pursuit',
  'community-pet-affection-reveal', 'window-explode', 'seedance-bunny-taxi', 'seedance-blocked-light',
  'seedance-anothers-opinion', 'seedance-rescue-myself', 'seedance-quick-change-2', 'seedance-quick-change',
  'seedance-roof-jump', 'seedance-glass-cube', 'seedance-subway-fight', 'cake-in-the-fridge',
  'game-character-rig', 'holiday-heist-run', 'community-dragon-awakening', 'community-skyline-flamingo-prank',
  'community-championship-slap-duel', 'community-urban-stride', 'community-supercar-night-fueling', 'community-truck-window-confrontation',
  'community-subway-combat-strike', 'community-street-shuffle-walk', 'community-supercar-midnight-refuel', 'community-drive-thru-dialogue',
  'community-urban-dance-walk', 'community-skyline-terrace-groove', 'community-london-gentleman-walk', 'community-dragon-rider-encounter',
  'community-forest-umbrella-shift', 'community-synchronized-pet-portrait', 'community-dramatic-office-outburst', 'community-midnight-forest-run',
  'community-coastal-driver-swap', 'community-midnight-sports-drive', 'community-shockwave-horizon-shift', 'community-boardwalk-dance-routine',
  'community-subway-mascot-dance', 'community-parkour-vault-shift', 'community-stage-dance-sync', 'community-cartoon-puppet-swap',
  'community-modern-listing-dolly', 'community-canyon-groove',
]);
