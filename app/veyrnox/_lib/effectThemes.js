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

const OVERRIDES = {
  PET: [
    'crazy-frog-race', 'jellyfish-airlines', 'pigeons', 'skatedog', 'puffin-flight',
    'dolphin-surf-ride', 'penguin-flight', 'sheep-kingdom', 'dinosaur-birthday-parade',
  ],
  'QUIRK LAB': [
    'selfception', 'act-natural', 'who-was-that-business', 'money-flex', 'melting',
    'the-wrong-one', 'laundromat-monster', 'many-eyed-portrait', 'tentacle-breakout',
  ],
  'MORPH ME': [
    'world-morphing', 'trick-or-skin', 'event-character-swap', 'character-takeover',
    'vanish', 'clones', 'infinite-clones', 'action-figure', 'marble-statue',
  ],
  'AI DANCE': [
    'storm-starring', 'superstar', 'moonwalk', 'blood-moon-dance',
    'monster-disco-party', 'rap-takeover', 'keyboard-duo-swap',
  ],
  'SOCCER FEVER': [
    'fat-parkour', 'wild-ride', 'incline', 'motorcycle-double', 'race-track',
    'high-flip', 'ink-sprint', 'mighty-fighter',
  ],
  'SHOT LANGUAGE': [
    'lidar', 'bullet-time', 'frozen-in-motion', 'earth-zoom', 'orbit-360',
    'motion-tracking', 'behind-the-lens', 'stop-world', 'escalator-loop',
  ],
  'AI GIFT': [
    'dandelion-ball', 'scrapbook-collage', 'sticker-peel-reveal', 'red-thread-story',
    'meal-together', 'floral-pool-portrait', 'colour-palette', 'birthday-highlight-reel',
  ],
  FESTIVAL: [
    'enchanted-forest-selfie', 'pumpkin-lings', 'dont-blow-out-the-pumpkin',
    'pumpkin-night', 'fairytale-castle', 'burning-man', 'birthday-rocket-launch',
    'candle-wish-world', 'giant-age-adventure', 'underwater-birthday-kingdom',
    'toybox-comes-alive', 'mini-cake-chef', 'birthday-news-report',
    'party-invitation-trailer', 'growing-up-timeline',
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
  return THEME_BY_ID[template?.id] || THEME_BY_CATEGORY[template?.category] || 'SHOT LANGUAGE';
}

export function themedTemplates(theme, templates) {
  if (!EFFECT_THEMES.some((entry) => entry.id === theme)) return [];
  return templates.filter((template) => effectThemeId(template) === theme);
}
