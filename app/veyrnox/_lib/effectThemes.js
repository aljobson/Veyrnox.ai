// Broad Veyrnox-owned discovery themes for the production template library.
// These are a navigation layer over existing original recipes and media, not
// source-platform names or imported template metadata.

export const EFFECT_THEMES = [
  { id: 'CREATURES', bg: 'linear-gradient(145deg,#0b2b24 0%,#176b57 58%,#a5f3cf 100%)' },
  { id: 'TRANSFORM', bg: 'linear-gradient(145deg,#22103d 0%,#6f35b5 58%,#f2a7ff 100%)' },
  { id: 'DANCE', bg: 'linear-gradient(145deg,#2b0a26 0%,#a32678 56%,#ff9f68 100%)' },
  { id: 'ACTION', bg: 'linear-gradient(145deg,#291006 0%,#a64116 56%,#ffd166 100%)' },
  { id: 'POWERS', bg: 'linear-gradient(145deg,#081b3b 0%,#174fa4 56%,#76e4ff 100%)' },
  { id: 'CAMERA', bg: 'linear-gradient(145deg,#111827 0%,#3f516f 58%,#cad5e5 100%)' },
  { id: 'ART STYLES', bg: 'linear-gradient(145deg,#32133a 0%,#b54876 54%,#ffd36e 100%)' },
  { id: 'BRAND', bg: 'linear-gradient(145deg,#171717 0%,#57534e 55%,#e7e5e4 100%)' },
  { id: 'CELEBRATE', bg: 'linear-gradient(145deg,#3b1220 0%,#c43d64 54%,#ffe27a 100%)' },
  { id: 'STORY', bg: 'linear-gradient(145deg,#0f172a 0%,#334155 56%,#d6a66f 100%)' },
];

const OVERRIDES = {
  CREATURES: [
    'crazy-frog-race', 'jellyfish-airlines', 'pigeons', 'skatedog', 'puffin-flight',
    'dolphin-surf-ride', 'penguin-flight', 'sheep-kingdom',
  ],
  TRANSFORM: [
    'world-morphing', 'trick-or-skin', 'event-character-swap', 'character-takeover',
    'vanish', 'selfception', 'clones', 'infinite-clones',
  ],
  DANCE: [
    'storm-starring', 'superstar', 'moonwalk', 'blood-moon-dance',
    'monster-disco-party', 'rap-takeover', 'keyboard-duo-swap',
  ],
  ACTION: [
    'fat-parkour', 'wild-ride', 'incline', 'motorcycle-double', 'race-track',
    'high-flip', 'ink-sprint', 'desert-train-heist', 'smash-and-grab', 'epic-slap-knockout',
  ],
  CAMERA: [
    'lidar', 'bullet-time', 'frozen-in-motion', 'earth-zoom', 'orbit-360',
    'motion-tracking', 'behind-the-lens', 'stop-world', 'escalator-loop', 'product-hero-360',
  ],
};

const THEME_BY_ID = Object.fromEntries(
  Object.entries(OVERRIDES).flatMap(([theme, ids]) => ids.map((id) => [id, theme])),
);

const THEME_BY_CATEGORY = {
  'KIDS BIRTHDAY': 'CELEBRATE',
  PRODUCTS: 'BRAND',
  ADS: 'BRAND',
  CARTOONS: 'ART STYLES',
  ANIME: 'ART STYLES',
  FASHION: 'ART STYLES',
  VFX: 'POWERS',
  FANTASY: 'POWERS',
  'YOUR PHOTO': 'TRANSFORM',
  CINEMATIC: 'STORY',
  MOVIES: 'STORY',
  REALISTIC: 'STORY',
  UGC: 'STORY',
};

export function effectThemeId(template) {
  return THEME_BY_ID[template?.id] || THEME_BY_CATEGORY[template?.category] || 'STORY';
}

export function themedTemplates(theme, templates) {
  if (!EFFECT_THEMES.some((entry) => entry.id === theme)) return [];
  return templates.filter((template) => effectThemeId(template) === theme);
}
