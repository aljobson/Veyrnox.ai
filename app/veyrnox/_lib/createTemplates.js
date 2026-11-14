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
    ...template,
    kind: 'audio',
    model: 'ACE-Step 1.5',
    credits: 3,
    category: 'MUSIC',
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
]);

export const CREATE_TEMPLATE_KINDS = Object.freeze(['video', 'image', 'audio']);

export function createTemplatesFor(kind) {
  return CREATE_TEMPLATES.filter((template) => template.kind === kind);
}

export function createTemplateById(id) {
  return CREATE_TEMPLATES.find((template) => template.id === id) || null;
}
