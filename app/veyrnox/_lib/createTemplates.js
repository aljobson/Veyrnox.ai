import { LICENSED_MUSIC_BASE, LICENSED_MUSIC_TRACKS } from '../../../lib/licensedMusicCatalog.js';
import { licensedTemplateFor } from '../../../lib/licensedTrackTemplates.js';

const common = Object.freeze({ isNew: true, original: true, createOnly: true });
const licensedTracks = new Map(LICENSED_MUSIC_TRACKS.map((track) => [track.id, track]));

function audioTemplate(template, licensedTrackId) {
  const track = licensedTracks.get(licensedTrackId);
  const licensed = licensedTemplateFor(licensedTrackId);
  if (!track || !licensed) throw new Error(`Unknown licensed track: ${licensedTrackId}`);
  return Object.freeze({
    ...common,
    category: 'MUSIC',
    ...template,
    kind: 'audio',
    model: 'ACE-Step 1.5',
    credits: 3,
    licensedTrackId,
    previewImage: `${LICENSED_MUSIC_BASE}${track.artwork}`,
    previewAudio: `${LICENSED_MUSIC_BASE}${track.file}`,
    previewTitle: track.title,
    previewCreator: track.creator,
    previewLicense: track.license,
    previewLicenseUrl: track.licenseUrl,
    previewSourceUrl: track.sourceUrl,
    previewAttribution: track.attribution,
    prompt: licensed.direction,
  });
}

// No video starts (owner decision, 2026-11-14): every listed video template must use the person's own photo, and
// these originals did not. Create's video picker points to the template gallery instead (TemplatePicker.js).
export const CREATE_TEMPLATES = Object.freeze([
  Object.freeze({ ...common, id: 'forest-light', name: 'FOREST LIGHT', kind: 'image', model: 'nano-banana-kie', credits: 1, category: 'REALISTIC', aspect: '3:4', previewAspect: '3 / 4', previewImage: '/showcase/images/cinematic-portrait.webp', bg: 'linear-gradient(145deg,#10231b,#506b55 55%,#d8a768)', prompt: 'Cinematic portrait of a woman turning toward the camera in a quiet forest, soft sunlight through tall trees, teal shadows, warm highlights, analog grain and a vertical light leak.' }),
  Object.freeze({ ...common, id: 'pastel-corridor', name: 'PASTEL CORRIDOR', kind: 'image', model: 'nano-banana-pro-grsai', credits: 2, category: 'REALISTIC', aspect: '3:4', previewAspect: '3 / 4', previewImage: '/showcase/images/hotel-corridor.webp', bg: 'linear-gradient(145deg,#553b42,#d1908e 55%,#d7b36a)', prompt: 'Perfectly symmetrical luxury hotel corridor in pastel pink, mustard and teal, a bellboy centered with two vintage suitcases, diffused light and immaculate storybook production design.' }),
  Object.freeze({ ...common, id: 'ripple-closeup', name: 'RIPPLE CLOSE-UP', kind: 'image', model: 'nano-banana-kie', credits: 1, category: 'REALISTIC', aspect: '3:4', previewAspect: '3 / 4', previewImage: '/showcase/images/ripple-light-portrait.webp', bg: 'linear-gradient(145deg,#111,#555 55%,#d7d7d7)', prompt: 'Hyperrealistic black-and-white extreme close-up portrait, luminous ripple-like lines flowing across natural skin texture, razor-thin focus, soft gray shadows and fine cinematic grain.' }),
  audioTemplate({ id: 'midnight-pulse', name: 'MIDNIGHT SOUL', bg: 'linear-gradient(145deg,#07101f,#253b74 55%,#7c62d6)' }, 'ccmixter-14246-midnight-theme-cdk-mix'),
  audioTemplate({ id: 'coastal-rhythm', name: 'AMBIENT DRIFT', bg: 'linear-gradient(145deg,#06191a,#167b78 55%,#8ed8b6)' }, 'scott-buckley-amberlight'),
  audioTemplate({ id: 'cinematic-lift', name: 'UPLIFTING RISE', bg: 'linear-gradient(145deg,#160b12,#713a42 55%,#e4ad72)' }, 'scott-buckley-rise-above'),
  audioTemplate({ id: 'late-night-jazz', name: 'LATE NIGHT JAZZ', bg: 'linear-gradient(145deg,#0d1020,#2f3b66 55%,#c9a0dc)' }, 'ccmixter-35050-winter-walk-silver-trumpet-mix'),
  audioTemplate({ id: 'headnod-groove', name: 'HEAD-NOD GROOVE', bg: 'linear-gradient(145deg,#14110d,#4a3b2a 55%,#c98a4b)' }, 'ccmixter-16626-i-dunno'),
  audioTemplate({ id: 'pocket-funk', name: 'POCKET FUNK', bg: 'linear-gradient(145deg,#1b0d18,#7a2e5c 55%,#f0a43c)' }, 'ccmixter-41411-1973'),
  audioTemplate({ id: 'open-road-rock', name: 'OPEN ROAD ROCK', bg: 'linear-gradient(145deg,#120d0d,#5a2a22 55%,#d9823b)' }, 'ccmixter-43098-drive'),
  audioTemplate({ id: 'neon-pulse', name: 'NEON PULSE', bg: 'linear-gradient(145deg,#07091c,#1f3a8a 55%,#35d0e6)' }, 'ccmixter-43002-sudden-goodbye'),
  audioTemplate({ id: 'porch-guitar', name: 'PORCH GUITAR', bg: 'linear-gradient(145deg,#17120b,#6b5230 55%,#e0c58a)' }, 'ccmixter-30638-chords-for-david'),
  audioTemplate({ id: 'slow-blues', name: 'SLOW BLUES', bg: 'linear-gradient(145deg,#07121f,#1d4a78 55%,#7fb2d9)' }, 'ccmixter-60675-blue-sky-blues'),
  audioTemplate({ id: 'sunny-offbeat', name: 'SUNNY OFFBEAT', bg: 'linear-gradient(145deg,#0c1a0c,#3f7a2e 55%,#f0d34a)' }, 'ccmixter-46263-summer-trip'),
  audioTemplate({ id: 'dreamy-indie', name: 'DREAMY INDIE', bg: 'linear-gradient(145deg,#17101d,#5b4a8c 55%,#e6b5d0)' }, 'ccmixter-31783-alternator'),
  audioTemplate({ id: 'chamber-elegance', name: 'CHAMBER ELEGANCE', bg: 'linear-gradient(145deg,#161015,#5a3a4a 55%,#d8c3a5)' }, 'ccmixter-24456-adagio-teru'),
  audioTemplate({ id: 'quiet-piano', name: 'QUIET PIANO', bg: 'linear-gradient(145deg,#0f1318,#35485c 55%,#b9c7d6)' }, 'scott-buckley-simplicity'),
  audioTemplate({ id: 'still-water', name: 'STILL WATER', bg: 'linear-gradient(145deg,#061519,#14606b 55%,#9bd8d2)' }, 'ccmixter-60674-renovation'),
  audioTemplate({ id: 'playful-pizzicato', name: 'PLAYFUL PIZZICATO', bg: 'linear-gradient(145deg,#1d1007,#a2561f 55%,#f3c76a)' }, 'scott-buckley-pumpkin-polka'),
  audioTemplate({ id: 'heroic-finale', name: 'HEROIC FINALE', category: 'CINEMATIC', bg: 'linear-gradient(145deg,#0d0b16,#4a2f6e 55%,#e9b95a)' }, 'scott-buckley-legacy'),
  audioTemplate({ id: 'creeping-dread', name: 'CREEPING DREAD', category: 'CINEMATIC', bg: 'linear-gradient(145deg,#050608,#222a33 55%,#6d7f8a)' }, 'scott-buckley-nightfall'),
  audioTemplate({ id: 'chase-pulse', name: 'CHASE PULSE', category: 'CINEMATIC', bg: 'linear-gradient(145deg,#13060a,#7a1f26 55%,#f08a4b)' }, 'scott-buckley-pursuit'),
  audioTemplate({ id: 'call-to-adventure', name: 'CALL TO ADVENTURE', category: 'CINEMATIC', bg: 'linear-gradient(145deg,#0a1410,#2f6b4a 55%,#e8d28a)' }, 'scott-buckley-call-to-adventure'),
]);

export const CREATE_TEMPLATE_KINDS = Object.freeze(['video', 'image', 'audio']);

export function createTemplatesFor(kind) {
  return CREATE_TEMPLATES.filter((template) => template.kind === kind);
}

export function createTemplateById(id) {
  return CREATE_TEMPLATES.find((template) => template.id === id) || null;
}
