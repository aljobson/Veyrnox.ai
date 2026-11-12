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
  Object.freeze({
    id: 'sunday-tape', title: 'Sunday Tape', creator: 'Veyrnox Sessions', section: 'New textures',
    mood: 'Lo-fi', bpm: 86, musicalKey: 'E-flat major', duration: '0:12',
    artwork: '/music-discover/sunday-tape.svg', accent: '#f59e0b', root: 155.56,
    wave: 'triangle', bass: [0, 7, 4, 9, 0, 11, 7, 4],
    recipe: 'Dusty lo-fi instrumental at 86 BPM in E-flat major, lazy pocket drums, soft electric bass, detuned piano fragments, cassette flutter and a sunlit Sunday-room atmosphere',
  }),
  Object.freeze({
    id: 'blue-velvet', title: 'Blue Velvet', creator: 'Veyrnox Sessions', section: 'New textures',
    mood: 'R&B', bpm: 98, musicalKey: 'F-sharp minor', duration: '0:12',
    artwork: '/music-discover/blue-velvet.svg', accent: '#818cf8', root: 185,
    wave: 'sine', bass: [0, 3, 7, 10, 7, 3, 12, 10],
    recipe: 'Silky contemporary R&B instrumental at 98 BPM in F-sharp minor, swung drums, deep bass, glassy electric piano, restrained guitar answers and midnight-blue space',
  }),
  Object.freeze({
    id: 'palm-circuit', title: 'Palm Circuit', creator: 'Veyrnox Sessions', section: 'New textures',
    mood: 'Afro House', bpm: 120, musicalKey: 'A minor', duration: '0:12',
    artwork: '/music-discover/palm-circuit.svg', accent: '#34d399', root: 110,
    wave: 'sawtooth', bass: [0, 7, 10, 7, 3, 10, 12, 7],
    recipe: 'Rolling Afro house instrumental at 120 BPM in A minor, layered hand percussion, grounded kick, elastic bass, marimba sparks and a warm open-air sunset pulse',
  }),
  Object.freeze({
    id: 'skyline-runner', title: 'Skyline Runner', creator: 'Veyrnox Sessions', section: 'Fast lane',
    mood: 'Drum & Bass', bpm: 136, musicalKey: 'D minor', duration: '0:12',
    artwork: '/music-discover/skyline-runner.svg', accent: '#38bdf8', root: 146.83,
    wave: 'sawtooth', bass: [0, 12, 10, 7, 3, 10, 7, 0],
    recipe: 'Liquid drum and bass instrumental at 136 BPM in D minor, crisp breakbeats, gliding sub bass, bright arpeggios, wide pads and fast blue-hour city motion',
  }),
  Object.freeze({
    id: 'redline-bloom', title: 'Redline Bloom', creator: 'Veyrnox Sessions', section: 'Fast lane',
    mood: 'Trap', bpm: 140, musicalKey: 'G minor', duration: '0:12',
    artwork: '/music-discover/redline-bloom.svg', accent: '#fb7185', root: 196,
    wave: 'square', bass: [0, 0, 3, 7, 10, 7, 12, 3],
    recipe: 'Tense melodic trap instrumental at 140 BPM in G minor, clipped drums, sliding sub bass, bell fragments, reversed ambience and a sharp red-neon chorus turn',
  }),
  Object.freeze({
    id: 'paper-satellites', title: 'Paper Satellites', creator: 'Veyrnox Sessions', section: 'Fast lane',
    mood: 'Indie Pop', bpm: 112, musicalKey: 'A major', duration: '0:12',
    artwork: '/music-discover/paper-satellites.svg', accent: '#f9a8d4', root: 110,
    wave: 'triangle', bass: [0, 7, 11, 4, 9, 7, 2, 11],
    recipe: 'Bright indie-pop instrumental at 112 BPM in A major, live-feeling drums, melodic bass, chiming guitars, handclap lift and a playful paper-sky hook',
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
