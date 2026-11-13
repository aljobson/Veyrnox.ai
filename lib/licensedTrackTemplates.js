import { LICENSED_MUSIC_TRACKS } from './licensedMusicCatalog.js';
import { MUSIC_SAMPLE_DIRECTION_MAX } from './musicDiscover.js';

// A template is a recipe on one licensed track: a generic style direction for
// the track's category, plus the track's credit line. The recording itself is
// never generation input. Directions are plain genre and mood words with no
// artist, track or brand names, written for an instrumental generator.
export const LICENSED_CATEGORY_DIRECTIONS = Object.freeze({
  'Cinematic adventure': 'Sweeping cinematic adventure score, rising strings and brass, driving percussion, hopeful and wide, instrumental.',
  'Piano & reflective': 'Intimate reflective solo piano, soft dynamics, slow unhurried phrasing, gentle room ambience, instrumental.',
  'Dark & suspense': 'Dark suspense underscore, low drones, tense strings, sparse percussion, slow creeping unease, instrumental.',
  'Action & hybrid': 'High-energy hybrid action score, pounding drums, pulsing synth bass, aggressive strings, urgent, instrumental.',
  'Ambient & atmospheric': 'Spacious atmospheric ambient, evolving pads, soft textures, distant shimmer, calm and weightless, instrumental.',
  Uplifting: 'Bright uplifting instrumental, optimistic melody, building arrangement, clapping rhythm, warm and energetic.',
  Whimsical: 'Playful whimsical instrumental, pizzicato strings, light woodwinds, bouncy rhythm, curious and cheerful.',
  'Epic orchestral': 'Epic orchestral theme, full strings, powerful brass, thunderous timpani, heroic build to a big finish, instrumental.',
  'Jazz & acoustic': 'Relaxed acoustic jazz, brushed drums, upright bass, warm guitar and piano, easy swing, instrumental.',
  'Hip-hop': 'Head-nod hip-hop instrumental, dusty drums, deep bass, chopped keys, laid-back groove, around 88 BPM.',
  Rock: 'Driving instrumental rock, crunchy guitars, punchy live drums, solid bass, confident mid-tempo energy.',
  Jazz: 'Smooth contemporary jazz instrumental, electric piano, walking bass, brushed swing drums, late-night mood.',
  Electronic: 'Modern electronic instrumental, tight synth bass, crisp drum machine, shimmering arpeggios, steady dance pulse.',
  Funk: 'Groovy funk instrumental, slap bass, tight clean guitar, punchy horns, danceable pocket drums.',
  Ambient: 'Minimal ambient instrumental, long soft pads, slow movement, quiet space, meditative and still.',
  Classical: 'Elegant classical chamber instrumental, strings and piano, balanced phrasing, graceful and composed.',
  Acoustic: 'Warm acoustic instrumental, fingerpicked guitar, soft percussion, gentle and organic, relaxed tempo.',
  Soul: 'Warm soul instrumental, Rhodes keys, mellow bass, smooth drums, rich chords, heartfelt and unhurried.',
  Indie: 'Dreamy indie instrumental, jangly guitars, light drums, airy synth, nostalgic and understated.',
  Blues: 'Gritty blues instrumental, expressive electric guitar, shuffling drums, walking bass, slow late-night feel.',
  Reggae: 'Laid-back reggae instrumental, offbeat guitar skank, deep round bass, one-drop drums, sunny and relaxed.',
});

const TRACK_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const byId = new Map(LICENSED_MUSIC_TRACKS.map((track) => [track.id, track]));

export function licensedTemplateFor(trackId) {
  if (typeof trackId !== 'string' || !TRACK_ID.test(trackId)) return null;
  const track = byId.get(trackId);
  const direction = track && LICENSED_CATEGORY_DIRECTIONS[track.category];
  if (!direction) return null;
  return Object.freeze({
    id: track.id,
    title: track.title,
    creator: track.creator,
    category: track.category,
    direction,
    attribution: track.attribution,
    license: track.license,
    licenseUrl: track.licenseUrl,
  });
}

/** Link for the track card; null when the id is not a catalog track. */
export function licensedTemplateHref(trackId) {
  return licensedTemplateFor(trackId) ? `/app/music/create?template=${encodeURIComponent(trackId)}` : null;
}

/**
 * Starting text for Simple mode. An explicit handoff beats a stored public
 * draft: sample seed, then licensed template, then the stored prompt.
 */
export function resolveInitialDescription({ sampleSeed = null, licensedTemplate = null, savedPrompt = '' } = {}) {
  if (sampleSeed) return '';
  if (licensedTemplate) return licensedTemplate.direction.slice(0, MUSIC_SAMPLE_DIRECTION_MAX);
  const saved = typeof savedPrompt === 'string' ? savedPrompt.trim() : '';
  return saved && saved.length <= 500 ? saved : '';
}
