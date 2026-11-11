export const MUSIC_SAMPLE_DIRECTION_MAX = 200;

export const MUSIC_DISCOVER_BEATS = Object.freeze([
  Object.freeze({
    id: 'neon-rain', title: 'Neon Rain', creator: 'Veyrnox Sessions', section: 'For you',
    mood: 'Night Drive', bpm: 92, musicalKey: 'C minor', duration: '0:12',
    artwork: '/music-discover/neon-rain.jpg', accent: '#22d3ee', root: 130.81,
    wave: 'triangle', bass: [0, 0, 3, 7, 0, 10, 7, 3],
    recipe: 'Nocturnal instrumental at 92 BPM in C minor, brushed half-time drums, warm sub bass, glassy synth pulses, rain-soft ambience and a spacious cinematic mix',
  }),
  Object.freeze({
    id: 'velvet-circuit', title: 'Velvet Circuit', creator: 'Veyrnox Sessions', section: 'For you',
    mood: 'Warm Analog', bpm: 106, musicalKey: 'F minor', duration: '0:12',
    artwork: '/music-discover/velvet-circuit.jpg', accent: '#fb923c', root: 174.61,
    wave: 'sawtooth', bass: [0, 7, 10, 7, 3, 7, 0, 10],
    recipe: 'Warm analog instrumental at 106 BPM in F minor, pocket drums, rounded electric bass, muted guitar chops, tape-worn keys and an intimate late-seventies glow',
  }),
  Object.freeze({
    id: 'glass-horizon', title: 'Glass Horizon', creator: 'Veyrnox Sessions', section: 'For you',
    mood: 'Bright Motion', bpm: 118, musicalKey: 'D major', duration: '0:12',
    artwork: '/music-discover/glass-horizon.jpg', accent: '#67e8f9', root: 146.83,
    wave: 'sine', bass: [0, 7, 11, 7, 4, 11, 7, 2],
    recipe: 'Weightless instrumental at 118 BPM in D major, crisp syncopated drums, buoyant bass, translucent mallets, airy pads and a bright open-sky chorus lift',
  }),
  Object.freeze({
    id: 'concrete-bloom', title: 'Concrete Bloom', creator: 'Veyrnox Sessions', section: 'Fresh signal',
    mood: 'Heavy', bpm: 138, musicalKey: 'E minor', duration: '0:12',
    artwork: '/music-discover/concrete-bloom.jpg', accent: '#f472b6', root: 164.81,
    wave: 'square', bass: [0, 0, 7, 3, 0, 10, 7, 12],
    recipe: 'Hard-edged instrumental at 138 BPM in E minor, distorted kick and snare, elastic sub bass, chopped industrial percussion, blooming synth chords and sharp dynamic drops',
  }),
  Object.freeze({
    id: 'golden-static', title: 'Golden Static', creator: 'Veyrnox Sessions', section: 'Fresh signal',
    mood: 'Cinematic', bpm: 84, musicalKey: 'A minor', duration: '0:12',
    artwork: '/music-discover/golden-static.jpg', accent: '#fbbf24', root: 110,
    wave: 'triangle', bass: [0, 7, 3, 10, 0, 12, 10, 7],
    recipe: 'Patient cinematic instrumental at 84 BPM in A minor, dry drums, deep pulsing bass, dusty radio texture, bowed synth layers and a slowly widening desert-scale arrangement',
  }),
  Object.freeze({
    id: 'after-hours', title: 'After Hours', creator: 'Veyrnox Sessions', section: 'Fresh signal',
    mood: 'Night Drive', bpm: 124, musicalKey: 'C-sharp minor', duration: '0:12',
    artwork: '/music-discover/after-hours.jpg', accent: '#3b82f6', root: 138.59,
    wave: 'sawtooth', bass: [0, 0, 7, 10, 3, 3, 12, 7],
    recipe: 'Polished after-dark instrumental at 124 BPM in C-sharp minor, tight club drums, rubber bass, clipped synth stabs, chrome reflections and a restrained red-blue tension',
  }),
]);

export const MUSIC_DISCOVER_MOODS = Object.freeze([
  'All', ...new Set(MUSIC_DISCOVER_BEATS.map((beat) => beat.mood)),
]);

export function getMusicDiscoverSeed(id) {
  if (typeof id !== 'string') return null;
  return MUSIC_DISCOVER_BEATS.find((beat) => beat.id === id) || null;
}

export function buildMusicSamplePrompt(seed, direction = '') {
  const canonical = getMusicDiscoverSeed(seed?.id);
  if (!canonical) return '';
  const next = typeof direction === 'string'
    ? direction.trim().slice(0, MUSIC_SAMPLE_DIRECTION_MAX)
    : '';
  return next
    ? `${canonical.recipe}. New direction: ${next}`
    : `${canonical.recipe}. Create a fresh instrumental variation with a distinct melody and arrangement.`;
}
