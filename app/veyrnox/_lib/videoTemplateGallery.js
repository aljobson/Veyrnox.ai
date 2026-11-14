// The video template gallery, capped at 100 (owner decision, 2026-11-14).
//
// Only community templates whose exact prompt uses the person's own photo (@image1, @image2, ...) and that can
// generate today are listed. Templates that use @video stay hidden until Veyrnox has a video reference slot
// (templateSourceBlock.js): they cannot reproduce their preview. Ranking: /api/popular-templates was empty on
// 2026-11-14 (no template had 20 accounts yet), so of the 103 that qualified the three with five image slots were
// dropped, keeping natural-viral-makeover. Hidden templates leave the gallery, search, /api/templates, /api/presets
// and the sitemap; their direct links still resolve (templateById reads ALL_TEMPLATES).
// tests/videoTemplateCap.test.mjs pins the cap and the @image rule.

export const VIDEO_TEMPLATE_CAP = 100;

export const VIDEO_GALLERY_TEMPLATE_IDS = Object.freeze([
  'epic-train-doorway-scene', 'the-push', 'dreamworks-castle', 'a-moment-between-strangers',
  'jellyfish-airlines', 'dandelion-ball', 'sm-brand-new-day', 'who-was-that-business',
  'trick-or-skin', 'the-wrong-one', 'enchanted-forest-selfie', 'hotel-window-watch',
  'curtain-reveal', 'escalator-loop', 'sheep-kingdom', 'fashion-catch',
  'desert-train-heist', 'natural-viral-makeover', 'pizzeria-hide-and-seek', 'coliseum-drift',
  'theater-ceiling-horror', 'studio-ballerina-turns', 'little-storm-knight', 'reflection-in-the-mirror',
  'car-blows-up', 'saved-by-darkness', 'pumpkin-guardian', 'fashion-halloween',
  'thrille', 'ghost-makeover', 'one-last-embrace', 'birthday-drift',
  'community-suit-workout-swap', 'the-giant-caretaker', 'ocean-car-sinking', 'edge-of-victory',
  'what-falls-next', 'office-kitchen', 'catch-of-the-day', 'the-beast-awakens',
  'grab-heist', 'office-escape', 'animal-pov-to-the-club', 'sketch-to-real-car',
  'car-sky-fall', 'underground-lab-transformation', 'the-spirit', 'the-crown',
  'dragon-lord', 'noir-film', 'desert-rider', 'split-jump',
  'impact', 'ruins-escape-run', 'curious-garden-journey', 'born-from-sand',
  'freefall', 'sculptural-sunglasses-ad', 'dont-touch-the-braids', 'last-supper',
  'x-ray-matter', 'edit-the-sky', 'sea-snakes', 'rooftop-agent-pursuit',
  'window-explode', 'seedance-birthday-morning', 'seedance-off-duty', 'seedance-hero-drive',
  'seedance-xp-daydream', 'seedance-toy-to-torque', 'seedance-groovy-golf-shot', 'seedance-frozen-getaway',
  'seedance-midair-photo', 'seedance-through-the-cloudline', 'seedance-bunny-taxi', 'seedance-best-friend',
  'seedance-blocked-light', 'seedance-anothers-opinion', 'seedance-butterfly-effect', 'seedance-rain-rider',
  'seedance-midnight-run', 'seedance-birthday-shot', 'seedance-popcorn-eruption', 'seedance-rescue-myself',
  'seedance-quick-change-2', 'seedance-quick-change', 'seedance-roof-jump', 'seedance-glass-cube',
  'seedance-still-my-friend', 'seedance-the-train-rushes-by', 'seedance-subway-fight', 'cake-in-the-fridge',
  'storybook-reality-recast', 'on-the-winter-roof', 'game-character-rig', 'holiday-heist-run',
  'the-winning-gift', 'the-bigger-gift', 'one-more-dance', 'snowball-revenge',
]);
