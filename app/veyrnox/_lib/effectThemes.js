// Discovery themes from the public AI-effects taxonomy reviewed on 23 October
// 2026. Only the short, generic concepts are reused. Veyrnox keeps its own
// recipes, prompts, pricing, models and preview media.

export const EFFECT_THEMES = [
  { id: 'PET', bg: 'linear-gradient(145deg,#0b2b24 0%,#176b57 58%,#a5f3cf 100%)' },
  { id: 'STYLE', bg: 'linear-gradient(145deg,#32133a 0%,#b54876 54%,#ffd36e 100%)' },
  { id: 'QUIRK LAB', bg: 'linear-gradient(145deg,#291006 0%,#a64116 56%,#ffd166 100%)' },
  { id: 'MORPH ME', bg: 'linear-gradient(145deg,#22103d 0%,#6f35b5 58%,#f2a7ff 100%)' },
  { id: 'AI DANCE', bg: 'linear-gradient(145deg,#2b0a26 0%,#a32678 56%,#ff9f68 100%)' },
  { id: 'SOCCER FEVER', bg: 'linear-gradient(145deg,#0c331c 0%,#168147 58%,#b7f34a 100%)' },
  { id: 'SUPER POWER', bg: 'linear-gradient(145deg,#081b3b 0%,#174fa4 56%,#76e4ff 100%)' },
  { id: 'E-COMMERCE', bg: 'linear-gradient(145deg,#171717 0%,#57534e 55%,#e7e5e4 100%)' },
  { id: 'SHOT LANGUAGE', bg: 'linear-gradient(145deg,#111827 0%,#3f516f 58%,#cad5e5 100%)' },
  { id: 'AI GIFT', bg: 'linear-gradient(145deg,#3b1220 0%,#c43d64 54%,#ffe27a 100%)' },
  { id: 'FESTIVAL', bg: 'linear-gradient(145deg,#40110a 0%,#c7371f 56%,#ffd86a 100%)' },
];

export const OVERRIDES = {
  PET: [
    "community-skydiving-cat-swap",
    "community-drive-thru-pup",
    "community-kitchen-feline-barista",
    "community-dapper-animal-duet",
    "community-feline-karate-cat",
    "community-bipedal-cat-sprint",
    "community-pet-dance-swapping",
    "community-feline-dance-crew",
    "community-kitchen-feline-reveal",
    "community-grooving-driver-dog",
    "community-canine-night-drive",
    "community-playful-animal-duel",
    "community-garden-duo-swap",
    "community-courier-pup",
    "community-snack-weight-check",
    "community-puppy-city-stroll",
    "community-kitchen-trombone-duo",
    "community-bartender-pup-shift",
    "community-spooky-dog-groove",
    "community-chihuahua-martial-artist",
    "community-kitchen-percussion-pet",
    "community-kitchen-canine-swap",
    "community-bathroom-mirror-paw",
    "community-pampered-pet-spa",
    "community-feline-street-style",
    "community-kitten-dance-challenge",

    'crazy-frog-race', 'jellyfish-airlines',
    'sheep-kingdom',
  ],
  'QUIRK LAB': [
    'who-was-that-business', 'money-flex',
    'the-wrong-one', 'tentacle-breakout',
  ],
  'MORPH ME': [
    'trick-or-skin', 'event-character-swap', 'character-takeover',
    'community-orbital-truck-morph', 'community-subway-landmark-swap',
    'community-period-character-swap',
  ],
  'AI DANCE': [
    "community-kitchen-dance",
    "community-studio-rap-performance",
    "community-sunset-group-dance",
    "community-elevator-dance-swap",
    "community-kitchen-dance-swap",
    "community-urban-dance-trio",
    "community-pink-studio-groove",
    "community-living-room-duo",
    "community-garage-duo-dance",
    "community-folk-dance-swap",
    "community-mint-suite-grooves",
    "community-boombox-street-groove",
    "community-urban-dance-group",
    "community-street-dance-recast",
    "community-duet-exchange",
    "community-cabin-rhythm-duo",
    "community-formal-dance-swap",
    "community-street-dance-swap",
    "community-urban-dance-squad",
    "community-parking-lot-remix",
    "community-mascot-stage-performance",
    "community-streetwear-dance-swap",
    "community-trio-dance-swap",
    "community-sunlit-bedroom-dance",
    "community-synchronized-group-formation",
    "community-hillside-dance-swap",
    "community-nightclub-duo-recast",
    "community-street-rap-collective",
    "community-skyline-rhythm-walk",
    "community-business-breakdance",
    "community-suit-synchronized-dance",
    "community-formal-groove",
    "community-balcony-trio-dance",
    "community-rap-battle-duo",
    "community-basement-band-trio",
    "community-keyboard-jam",
    "community-bedroom-dance-groove",
    "community-courtyard-character-swap",
    "community-double-character-swap",
    "community-nightclub-dj-set",
    "community-stage-performance-recast",
    "community-industrial-lens-flare",
    "community-alleyway-dance-crew",
    "community-party-crowd-swop",
    "community-brooklyn-bridge-groove",
    "community-parkside-dance-reimagined",
    "community-dual-character-swap",
    "community-retro-housewife-dance",

    'storm-starring', 'blood-moon-dance',
    'rap-takeover',
  ],
  'SOCCER FEVER': [
    'fat-parkour',
    'football',
    'community-soccer-dribble', 'community-tunnel-wheelie',
    'community-athlete-dance-swap',
  ],
  'SHOT LANGUAGE': [
    'escalator-loop',
  ],
  'AI GIFT': [
    'dandelion-ball', 'red-thread-story',
    'meal-together',
  ],
  FESTIVAL: [
    'enchanted-forest-selfie',
    'pumpkin-night',
  ],
};

const THEME_BY_ID = Object.fromEntries(
  Object.entries(OVERRIDES).flatMap(([theme, ids]) => ids.map((id) => [id, theme])),
);

const THEME_BY_CATEGORY = {
  PRODUCTS: 'E-COMMERCE',
  ADS: 'E-COMMERCE',
  CARTOONS: 'STYLE',
  ANIME: 'STYLE',
  FASHION: 'STYLE',
  VFX: 'SUPER POWER',
  FANTASY: 'SUPER POWER',
  'YOUR PHOTO': 'MORPH ME',
  CINEMATIC: 'SHOT LANGUAGE',
  MOVIES: 'SHOT LANGUAGE',
  REALISTIC: 'SHOT LANGUAGE',
  UGC: 'QUIRK LAB',
  'KIDS BIRTHDAY': 'FESTIVAL',
};

export function effectThemeId(template) {
  return template?.theme || THEME_BY_ID[template?.id] || THEME_BY_CATEGORY[template?.category] || 'SHOT LANGUAGE';
}

export function themedTemplates(theme, templates) {
  if (!EFFECT_THEMES.some((entry) => entry.id === theme)) return [];
  return templates.filter((template) => effectThemeId(template) === theme);
}
