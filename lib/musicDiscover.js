export const MUSIC_SAMPLE_DIRECTION_MAX = 200;

const SECTIONS = ['For you', 'Fresh signal', 'Slow burn', 'Fast lane', 'Cinematic worlds'];
const KEYS = ['C minor', 'F minor', 'D major', 'E minor', 'A minor', 'C-sharp minor', 'E-flat major', 'F-sharp minor', 'D minor', 'G minor'];
const ROOTS = [130.81, 174.61, 146.83, 164.81, 110, 138.59, 155.56, 185, 146.83, 196];
const WAVES = ['triangle', 'sawtooth', 'sine', 'square'];
const BASS_PATTERNS = [
  [0, 0, 3, 7, 0, 10, 7, 3],
  [0, 7, 10, 7, 3, 7, 0, 10],
  [0, 7, 11, 7, 4, 11, 7, 2],
  [0, 0, 7, 3, 0, 10, 7, 12],
  [0, 7, 3, 10, 0, 12, 10, 7],
];

const GENRES = [
  {
    mood: 'Hip-hop', bpm: 88, section: SECTIONS[0], accent: '#22d3ee',
    titles: ['Neon Rain', 'Pocket Theory', 'Eastbound Static', 'Low Key Cinema', 'Corner Light'],
    direction: 'Head-nod hip-hop', drums: 'crisp pocket drums', bass: 'warm sub bass', melody: 'chopped keys and vinyl-soft melodic fragments',
  },
  {
    mood: 'Rock', bpm: 118, section: SECTIONS[0], accent: '#fb7185',
    titles: ['Velvet Circuit', 'Iron Harbour', 'Midnight Amp', 'Open Road Echo', 'Signal Fire'],
    direction: 'Driving modern rock', drums: 'live-feeling drums', bass: 'picked electric bass', melody: 'wide guitars and an anthemic hook',
  },
  {
    mood: 'Jazz', bpm: 104, section: SECTIONS[0], accent: '#fbbf24',
    titles: ['Glass Horizon', 'Blue Room Steps', 'After Five', 'Copper Keys', 'Side Street Swing'],
    direction: 'Contemporary jazz', drums: 'brushed syncopated drums', bass: 'upright bass movement', melody: 'electric piano voicings and restrained horn answers',
  },
  {
    mood: 'Electronic', bpm: 124, section: SECTIONS[0], accent: '#38bdf8',
    titles: ['After Hours', 'Chrome Current', 'Soft Machine', 'Pulse Window', 'Digital Coast'],
    direction: 'Polished electronic', drums: 'tight club drums', bass: 'rubber synth bass', melody: 'clipped synth stabs and bright arpeggio motion',
  },
  {
    mood: 'Funk', bpm: 108, section: SECTIONS[1], accent: '#f97316',
    titles: ['Concrete Bloom', 'Pocket Mirror', 'Gold Wire', 'Sidewalk Elastic', 'Velour Steps'],
    direction: 'Elastic modern funk', drums: 'dry pocket drums', bass: 'syncopated slap bass', melody: 'muted guitar chops and bright clavinet sparks',
  },
  {
    mood: 'Ambient', bpm: 82, section: SECTIONS[1], accent: '#67e8f9',
    titles: ['Cloud Archive', 'Quiet Latitude', 'Silver Air', 'Weightless Room', 'Drift Signal'],
    direction: 'Weightless ambient', drums: 'soft pulse percussion', bass: 'slow rounded low tones', melody: 'translucent pads and distant bell harmonics',
  },
  {
    mood: 'Classical', bpm: 90, section: SECTIONS[1], accent: '#c4b5fd',
    titles: ['Paper Sonata', 'North Hall', 'Small Orchestra', 'Ivory Current', 'String Lantern'],
    direction: 'Modern chamber classical', drums: 'subtle orchestral percussion', bass: 'cello-led low movement', melody: 'piano motifs and intimate string counterpoint',
  },
  {
    mood: 'Acoustic', bpm: 96, section: SECTIONS[1], accent: '#f59e0b',
    titles: ['Sunday Tape', 'Woodsmoke Morning', 'Porch Light', 'Open Window Folk', 'Maple Thread'],
    direction: 'Warm acoustic', drums: 'hand-played soft drums', bass: 'rounded acoustic bass', melody: 'fingerpicked guitar and close-room piano details',
  },
  {
    mood: 'Soul', bpm: 92, section: SECTIONS[2], accent: '#a78bfa',
    titles: ['Blue Velvet', 'Slow Gold', 'Velvet Morning', 'Tender Static', 'Deep Colour'],
    direction: 'Silky contemporary soul', drums: 'swung pocket drums', bass: 'deep melodic bass', melody: 'electric piano, organ air and restrained guitar answers',
  },
  {
    mood: 'Indie', bpm: 112, section: SECTIONS[2], accent: '#f9a8d4',
    titles: ['Paper Satellites', 'Small Town Frequency', 'Window Seat', 'Polaroid Weather', 'Bright Sidewalk'],
    direction: 'Bright indie', drums: 'live-feeling drums', bass: 'melodic picked bass', melody: 'chiming guitars and a playful handclap hook',
  },
  {
    mood: 'Blues', bpm: 86, section: SECTIONS[2], accent: '#60a5fa',
    titles: ['Midnight Freight', 'Blue Line Home', 'Dusty Valve', 'Riverbend Walk', 'Late Train'],
    direction: 'Smoky modern blues', drums: 'loose shuffle drums', bass: 'walking electric bass', melody: 'worn electric guitar phrases and warm organ responses',
  },
  {
    mood: 'Reggae', bpm: 94, section: SECTIONS[2], accent: '#4ade80',
    titles: ['Island Relay', 'Green Horizon', 'Dub Postcard', 'Sunline Echo', 'Easy Current'],
    direction: 'Laid-back reggae', drums: 'one-drop drums', bass: 'deep rolling bass', melody: 'offbeat guitar, organ bubbles and open-air dub space',
  },
  {
    mood: 'R&B', bpm: 98, section: SECTIONS[3], accent: '#818cf8',
    titles: ['Moonlit Reply', 'Soft Focus', 'Velvet Call', 'Blue Hour Text', 'Slow Motion Glass'],
    direction: 'Contemporary R&B', drums: 'swung detailed drums', bass: 'silky sub bass', melody: 'glassy electric piano and spacious vocal-like synth answers',
  },
  {
    mood: 'Afro House', bpm: 120, section: SECTIONS[3], accent: '#34d399',
    titles: ['Palm Circuit', 'Copper Sun', 'Open Air Signal', 'Coastal Drum', 'Night Market'],
    direction: 'Rolling Afro house', drums: 'layered hand percussion and grounded kick', bass: 'elastic house bass', melody: 'marimba sparks and warm sunset synth phrases',
  },
  {
    mood: 'Drum & Bass', bpm: 136, section: SECTIONS[3], accent: '#0ea5e9',
    titles: ['Skyline Runner', 'Blue Velocity', 'Rapid Glass', 'Night Platform', 'Liquid Avenue'],
    direction: 'Liquid drum and bass', drums: 'crisp fast breakbeats', bass: 'gliding sub bass', melody: 'bright arpeggios and wide blue-hour pads',
  },
  {
    mood: 'Trap', bpm: 140, section: SECTIONS[3], accent: '#e11d48',
    titles: ['Redline Bloom', 'Black Ice Bell', 'Low Ceiling', 'Chrome Shadow', 'Southbound Signal'],
    direction: 'Tense melodic trap', drums: 'clipped drums and rolling hats', bass: 'sliding sub bass', melody: 'bell fragments and reversed ambient turns',
  },
  {
    mood: 'Lo-fi', bpm: 84, section: SECTIONS[4], accent: '#d97706',
    titles: ['Cassette Weather', 'Study Window', 'Dust Loop', 'Rainy Desk', 'Soft Pencil'],
    direction: 'Dusty lo-fi', drums: 'lazy pocket drums', bass: 'soft electric bass', melody: 'detuned piano fragments and gentle cassette flutter',
  },
  {
    mood: 'Cinematic', bpm: 84, section: SECTIONS[4], accent: '#fbbf24',
    titles: ['Golden Static', 'Distant Province', 'Last Light Frame', 'Wide Desert', 'Signal at Dawn'],
    direction: 'Patient cinematic', drums: 'dry dramatic drums', bass: 'deep pulsing bass', melody: 'bowed synth layers and a slowly widening orchestral lift',
  },
  {
    mood: 'House', bpm: 126, section: SECTIONS[4], accent: '#2dd4bf',
    titles: ['Mirror Floor', 'Night Key', 'Warehouse Air', 'Soft Strobe', 'Morning Club'],
    direction: 'Clean modern house', drums: 'four-on-the-floor drums and bright hats', bass: 'rounded club bass', melody: 'piano stabs and a restrained uplifting synth hook',
  },
  {
    mood: 'Latin', bpm: 116, section: SECTIONS[4], accent: '#fb923c',
    titles: ['Amber Plaza', 'Coastal Steps', 'Rooftop Marimba', 'Warm Street', 'Sunset Motion'],
    direction: 'Warm Latin fusion', drums: 'layered conga and shaker rhythm', bass: 'syncopated electric bass', melody: 'nylon guitar, piano sparks and a bright melodic refrain',
  },
];

function slug(value) {
  return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildBeat(genre, genreIndex, title, titleIndex) {
  const bpm = genre.bpm + (titleIndex - 2) * 2;
  const variant = genreIndex * 5 + titleIndex;
  const musicalKey = KEYS[variant % KEYS.length];
  return Object.freeze({
    id: slug(title), title, creator: 'Veyrnox Sessions', section: genre.section, mood: genre.mood,
    bpm, musicalKey, duration: '0:12', artwork: `/music-discover/samples/${slug(title)}.svg`,
    accent: genre.accent, root: ROOTS[variant % ROOTS.length], wave: WAVES[variant % WAVES.length],
    bass: BASS_PATTERNS[variant % BASS_PATTERNS.length], lead: BASS_PATTERNS[(variant + 2) % BASS_PATTERNS.length],
    recipe: `${genre.direction} instrumental at ${bpm} BPM in ${musicalKey}, ${genre.drums}, ${genre.bass}, ${genre.melody}, and a distinct ${title.toLowerCase()} arrangement built as a fresh original variation`,
  });
}

export const MUSIC_DISCOVER_BEATS = Object.freeze(GENRES.flatMap((genre, genreIndex) => (
  genre.titles.map((title, titleIndex) => buildBeat(genre, genreIndex, title, titleIndex))
)));

export const MUSIC_DISCOVER_MOODS = Object.freeze(['All', ...GENRES.map((genre) => genre.mood)]);
export const MUSIC_DISCOVER_SECTIONS = Object.freeze(SECTIONS);

export function getMusicDiscoverSeed(id) {
  if (typeof id !== 'string') return null;
  return MUSIC_DISCOVER_BEATS.find((beat) => beat.id === id) || null;
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

export function normalizeMusicSampleMix(input) {
  return Object.freeze({
    tempo: clamp(input?.tempo, 0.75, 1.25, 1),
    drums: Math.round(clamp(input?.drums, 0, 100, 100)),
    bass: Math.round(clamp(input?.bass, 0, 100, 100)),
    melody: Math.round(clamp(input?.melody, 0, 100, 100)),
  });
}

export function isDefaultMusicSampleMix(input) {
  const mix = normalizeMusicSampleMix(input);
  return mix.tempo === 1 && mix.drums === 100 && mix.bass === 100 && mix.melody === 100;
}

export function buildMusicSamplePrompt(seed, direction = '', sampleMix = null) {
  const canonical = getMusicDiscoverSeed(seed?.id);
  if (!canonical) return '';
  const next = typeof direction === 'string' ? direction.trim().slice(0, MUSIC_SAMPLE_DIRECTION_MAX) : '';
  const mix = normalizeMusicSampleMix(sampleMix);
  const mixDirection = sampleMix && !isDefaultMusicSampleMix(mix)
    ? ` Mix plan: ${Math.round(mix.tempo * 100)}% speed, drums ${mix.drums}%, bass ${mix.bass}%, melody ${mix.melody}%.`
    : '';
  return next
    ? `${canonical.recipe}.${mixDirection} New direction: ${next}`
    : `${canonical.recipe}.${mixDirection} Create a fresh instrumental variation with a distinct melody and arrangement.`;
}
