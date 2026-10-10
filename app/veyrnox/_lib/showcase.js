// Preview provenance is recorded per clip. Imported inspiration does not
// represent a Veyrnox model output; tested Veyrnox examples are marked below.
// Provenance and encode settings:
// docs/product/showcase-clips.md
//
// Local files keep playback within the existing same-origin media policy.
export const SHOWCASE_SOURCES = [
  { name: 'SYNTX', url: 'https://syntx.ai/trends' },
  { name: 'Higgsfield', url: 'https://higgsfield.ai/' },
  { name: 'Veyrnox', url: 'https://veyrnox.ai/' },
];

export const SHOWCASE_CLIPS = {
  'wan-2.5-kie': {
    video: '/showcase/higgsfield-high-flip.mp4',
    poster: '/showcase/higgsfield-high-flip.jpg',
    title: 'High flip',
    source: 'Higgsfield',
  },
  'nano-banana-kie': {
    video: '/showcase/syntx-medieval-runway-look.mp4',
    poster: '/showcase/syntx-medieval-runway-look.jpg',
    title: 'Medieval Runway Look',
    source: 'SYNTX',
    objectPosition: '50% 10%',
  },
  'kling-26': {
    video: '/showcase/higgsfield-world-morphing.mp4',
    poster: '/showcase/higgsfield-world-morphing.jpg',
    title: 'World morphing',
    source: 'Higgsfield',
  },
  'presets': {
    video: '/showcase/higgsfield-street-colossus.mp4',
    poster: '/showcase/higgsfield-street-colossus.jpg',
    title: 'Street colossus',
    source: 'Higgsfield',
    objectPosition: '50% 10%',
  },
  'ace-step': {
    video: '/showcase/syntx-keyboard-duo-swap.mp4',
    poster: '/showcase/syntx-keyboard-duo-swap.jpg',
    title: 'Keyboard Duo Swap',
    source: 'SYNTX',
  },
  'cctv-night': {
    video: '/showcase/syntx-shadow-warriors.mp4',
    poster: '/showcase/syntx-shadow-warriors.jpg',
    title: 'Shadow Warriors',
    source: 'SYNTX',
  },
  'sunset-drift': {
    video: '/showcase/higgsfield-wild-ride.mp4',
    poster: '/showcase/higgsfield-wild-ride.jpg',
    title: 'Wild ride',
    source: 'Higgsfield',
  },
  'neon-alley': {
    video: '/showcase/syntx-storm-starring.mp4',
    poster: '/showcase/syntx-storm-starring.jpg',
    title: 'Storm Starring',
    source: 'SYNTX',
  },
  'warm-portrait': {
    video: '/showcase/higgsfield-studio-slide.mp4',
    poster: '/showcase/higgsfield-studio-slide.jpg',
    title: 'Studio slide',
    source: 'Higgsfield',
  },
  'film-portrait': {
    video: '/showcase/syntx-epic-train-doorway-scene.mp4',
    poster: '/showcase/syntx-epic-train-doorway-scene.jpg',
    title: 'Epic Train Doorway Scene',
    source: 'SYNTX',
    objectPosition: '50% 20%',
  },
  'talking-head': {
    video: '/showcase/syntx-fat-parkour.mp4',
    poster: '/showcase/syntx-fat-parkour.jpg',
    title: 'Fat Parkour',
    source: 'SYNTX',
  },
  'clean-cutout': {
    video: '/showcase/higgsfield-cutout.mp4',
    poster: '/showcase/higgsfield-cutout.jpg',
    title: 'Cutout',
    source: 'Higgsfield',
  },
  'editorial-flatlay': {
    video: '/showcase/higgsfield-floating-fall.mp4',
    poster: '/showcase/higgsfield-floating-fall.jpg',
    title: 'Floating fall',
    source: 'Higgsfield',
  },
  'street-portrait': {
    video: '/showcase/higgsfield-eyes-in.mp4',
    poster: '/showcase/higgsfield-eyes-in.jpg',
    title: 'Eyes in',
    source: 'Higgsfield',
  },
  'packshot-studio': {
    video: '/showcase/higgsfield-smash-and-grab.mp4',
    poster: '/showcase/higgsfield-smash-and-grab.jpg',
    title: 'Smash and grab',
    source: 'Higgsfield',
  },
  'try-the-look': {
    video: '/showcase/higgsfield-incline.mp4',
    poster: '/showcase/higgsfield-incline.jpg',
    title: 'Incline',
    source: 'Higgsfield',
  },
  'ugc-unboxing': {
    video: '/showcase/higgsfield-selfception.mp4',
    poster: '/showcase/higgsfield-selfception.jpg',
    title: 'Selfception',
    source: 'Higgsfield',
  },
  'miniature-city': {
    video: '/showcase/higgsfield-act-natural.mp4',
    poster: '/showcase/higgsfield-act-natural.jpg',
    title: 'Act natural',
    source: 'Higgsfield',
  },
  'product-hero': {
    video: '/showcase/higgsfield-lacewalker.mp4',
    poster: '/showcase/higgsfield-lacewalker.jpg',
    title: 'Lacewalker',
    source: 'Higgsfield',
  },
  'noir-one-sheet': {
    video: '/showcase/higgsfield-burning-man.mp4',
    poster: '/showcase/higgsfield-burning-man.jpg',
    title: 'Burning man',
    source: 'Higgsfield',
  },
  'saturday-cartoon': {
    video: '/showcase/higgsfield-melting.mp4',
    poster: '/showcase/higgsfield-melting.jpg',
    title: 'Melting',
    source: 'Higgsfield',
  },
  'anime-hero': {
    video: '/showcase/syntx-crazy-frog-race.mp4',
    poster: '/showcase/syntx-crazy-frog-race.jpg',
    title: 'Crazy Frog Race',
    source: 'SYNTX',
  },
  'photo-to-motion': {
    video: '/showcase/veyrnox-frozen-in-motion.mp4',
    poster: '/showcase/veyrnox-frozen-in-motion.jpg',
    title: 'Frozen in motion',
    source: 'Veyrnox',
    generatedOnVeyrnox: true,
    objectFit: 'contain',
  },
  'runway-walk': {
    video: '/showcase/higgsfield-fallen-angel.mp4',
    poster: '/showcase/higgsfield-fallen-angel.jpg',
    title: 'Fallen angel',
    source: 'Higgsfield',
  },
  'anime-opening': {
    video: '/showcase/higgsfield-monster-dab.mp4',
    poster: '/showcase/higgsfield-monster-dab.jpg',
    title: 'Monster dab',
    source: 'Higgsfield',
  },
  'portal-burst': {
    video: '/showcase/syntx-the-push.mp4',
    poster: '/showcase/syntx-the-push.jpg',
    title: 'The Push',
    source: 'SYNTX',
  },
  'floating-castle': {
    video: '/showcase/syntx-dreamworks-castle.mp4',
    poster: '/showcase/syntx-dreamworks-castle.jpg',
    title: 'Dreamworks Castle',
    source: 'SYNTX',
  },
  'wall-cctv-night': {
    video: '/showcase/higgsfield-lidar.mp4',
    poster: '/showcase/higgsfield-lidar.jpg',
    title: 'Lidar transition',
    source: 'Higgsfield',
  },
  'wall-sunset-drift': {
    video: '/showcase/higgsfield-boarding-pass.mp4',
    poster: '/showcase/higgsfield-boarding-pass.jpg',
    title: 'boarding pass',
    source: 'Higgsfield',
  },
  'wall-neon-alley': {
    video: '/showcase/higgsfield-architecture-wave.mp4',
    poster: '/showcase/higgsfield-architecture-wave.jpg',
    title: 'Architecture wave',
    source: 'Higgsfield',
  },
  'wall-warm-portrait': {
    video: '/showcase/syntx-a-moment-between-strangers.mp4',
    poster: '/showcase/syntx-a-moment-between-strangers.jpg',
    title: 'A Moment Between Strangers',
    source: 'SYNTX',
  },
  'wall-film-portrait': {
    video: '/showcase/syntx-the-last-stagecoach.mp4',
    poster: '/showcase/syntx-the-last-stagecoach.jpg',
    title: 'The Last Stagecoach',
    source: 'SYNTX',
  },
  'wall-talking-head': {
    video: '/showcase/higgsfield-clones.mp4',
    poster: '/showcase/higgsfield-clones.jpg',
    title: 'Clones',
    source: 'Higgsfield',
  },
  'wall-clean-cutout': {
    video: '/showcase/higgsfield-vanish.mp4',
    poster: '/showcase/higgsfield-vanish.jpg',
    title: 'Vanish',
    source: 'Higgsfield',
  },
  'model-video': {
    video: '/showcase/higgsfield-bullet-time.mp4',
    poster: '/showcase/higgsfield-bullet-time.jpg',
    title: 'Bullet time',
    source: 'Higgsfield',
  },
  'model-image': {
    video: '/showcase/higgsfield-pearl-earring.mp4',
    poster: '/showcase/higgsfield-pearl-earring.jpg',
    title: 'Pearl earring',
    source: 'Higgsfield',
  },
  'model-audio': {
    video: '/showcase/higgsfield-superstar.mp4',
    poster: '/showcase/higgsfield-superstar.jpg',
    title: 'Superstar',
    source: 'Higgsfield',
  },
};

// Give each public placement its own clip, including templates also on /presets.
export const WALL_SHOWCASE_KEYS = {
  'lidar': 'wall-cctv-night',
  'boarding-pass': 'wall-sunset-drift',
  'architecture-wave': 'wall-neon-alley',
  'a-moment-between-strangers': 'wall-warm-portrait',
  'the-last-stagecoach': 'wall-film-portrait',
  'clones': 'wall-talking-head',
  'vanish': 'wall-clean-cutout',
};

export const MODEL_SHOWCASE_KEYS = {
  video: 'model-video',
  image: 'model-image',
  audio: 'model-audio',
};

// A five-second muted preview stays small even when every tile has footage.
export const MAX_CLIP_BYTES = 2 * 1024 * 1024;
