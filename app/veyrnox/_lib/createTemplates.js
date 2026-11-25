const common = Object.freeze({ isNew: true, original: true, createOnly: true });
function soundTemplate(template) {
  return Object.freeze({
    ...common,
    category: 'SOUND FX',
    ...template,
    kind: 'audio',
    model: 'Suno Sound Effects',
    credits: 2,
  });
}

// No video starts (owner decision, 2026-11-14): every listed video template must use the person's own photo, and
// these originals did not. Create's video picker points to the template gallery instead (TemplatePicker.js).
export const CREATE_TEMPLATES = Object.freeze([
  Object.freeze({ ...common, id: 'forest-light', name: 'FOREST LIGHT', kind: 'image', model: 'nano-banana-kie', credits: 1, category: 'REALISTIC', aspect: '3:4', previewAspect: '3 / 4', previewImage: '/showcase/images/cinematic-portrait.webp', bg: 'linear-gradient(145deg,#10231b,#506b55 55%,#d8a768)', prompt: 'Cinematic portrait of a woman turning toward the camera in a quiet forest, soft sunlight through tall trees, teal shadows, warm highlights, analog grain and a vertical light leak.' }),
  Object.freeze({ ...common, id: 'pastel-corridor', name: 'PASTEL CORRIDOR', kind: 'image', model: 'nano-banana-pro-grsai', credits: 2, category: 'REALISTIC', aspect: '3:4', previewAspect: '3 / 4', previewImage: '/showcase/images/hotel-corridor.webp', bg: 'linear-gradient(145deg,#553b42,#d1908e 55%,#d7b36a)', prompt: 'Perfectly symmetrical luxury hotel corridor in pastel pink, mustard and teal, a bellboy centered with two vintage suitcases, diffused light and immaculate storybook production design.' }),
  Object.freeze({ ...common, id: 'ripple-closeup', name: 'RIPPLE CLOSE-UP', kind: 'image', model: 'nano-banana-kie', credits: 1, category: 'REALISTIC', aspect: '3:4', previewAspect: '3 / 4', previewImage: '/showcase/images/ripple-light-portrait.webp', bg: 'linear-gradient(145deg,#111,#555 55%,#d7d7d7)', prompt: 'Hyperrealistic black-and-white extreme close-up portrait, luminous ripple-like lines flowing across natural skin texture, razor-thin focus, soft gray shadows and fine cinematic grain.' }),
  soundTemplate({ id: 'city-rain-window', name: 'CITY RAIN WINDOW', previewImage: '/showcase/images/hotel-corridor.webp', bg: 'linear-gradient(145deg,#07101f,#253b74 55%,#7c62d6)', prompt: 'Steady evening rain against a large apartment window, distant city traffic, soft room tone, no music and no voices.' }),
  soundTemplate({ id: 'forest-morning-birds', name: 'FOREST MORNING', previewImage: '/showcase/images/cinematic-portrait.webp', bg: 'linear-gradient(145deg,#06191a,#167b78 55%,#8ed8b6)', prompt: 'Peaceful dawn forest ambience with light wind through leaves, scattered songbirds and a distant stream, no music.' }),
  soundTemplate({ id: 'cinematic-whoosh-hit', name: 'WHOOSH AND HIT', previewImage: '/showcase/images/ripple-light-portrait.webp', bg: 'linear-gradient(145deg,#160b12,#713a42 55%,#e4ad72)', prompt: 'A fast cinematic riser whoosh ending in one deep clean impact, polished trailer sound design, no melody or speech.' }),
  soundTemplate({ id: 'coffee-shop-roomtone', name: 'COFFEE SHOP', previewImage: '/showcase/images/hotel-corridor.webp', bg: 'linear-gradient(145deg,#14110d,#4a3b2a 55%,#c98a4b)', prompt: 'Warm independent coffee shop ambience with low indistinct chatter, cups setting down and a gentle espresso machine hiss.' }),
  soundTemplate({ id: 'retro-game-success', name: 'RETRO SUCCESS', previewImage: '/showcase/images/ripple-light-portrait.webp', bg: 'linear-gradient(145deg,#07091c,#1f3a8a 55%,#35d0e6)', prompt: 'Short retro arcade success sound with bright digital chimes and a crisp final sparkle, no spoken words.' }),
  soundTemplate({ id: 'ocean-loop', name: 'OCEAN LOOP', previewImage: '/showcase/images/cinematic-portrait.webp', bg: 'linear-gradient(145deg,#061519,#14606b 55%,#9bd8d2)', prompt: 'Seamless calm ocean shoreline loop with gentle waves, light foam and a soft coastal breeze, no birds, music or voices.' }),
]);

export const CREATE_TEMPLATE_KINDS = Object.freeze(['video', 'image', 'audio']);

export function createTemplatesFor(kind) {
  return CREATE_TEMPLATES.filter((template) => template.kind === kind);
}

export function createTemplateById(id) {
  return CREATE_TEMPLATES.find((template) => template.id === id) || null;
}
