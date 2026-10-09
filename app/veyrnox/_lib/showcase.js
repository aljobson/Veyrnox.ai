// Viral inspiration for every landing tile, sourced at the owner's request.
// These previews are credited to their source and do not represent a specific
// Veyrnox model or preset output. Provenance and encode settings:
// docs/product/showcase-clips.md
//
// Local files keep playback within the existing same-origin media policy.
export const SHOWCASE_SOURCES = [
  { name: 'SYNTX', url: 'https://syntx.ai/trends' },
  { name: 'Higgsfield', url: 'https://higgsfield.ai/' },
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
};

// A five-second muted preview stays small even when every tile has footage.
export const MAX_CLIP_BYTES = 2 * 1024 * 1024;
