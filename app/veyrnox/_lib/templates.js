// Templates (the /presets gallery): a look pinned to one model, with its own
// prompt, aspect ratio and, where the model needs one, a note of what to
// upload. "Use this template" hands prompt and aspect to the studio
// (landingDraft.js), so the studio's own upload, consent and pricing apply —
// nothing here charges or calls a provider.
//
// `model` is the display name in MODELS (tokens.js), resolved to an id by
// modelIdForName; `credits` must equal that model's 5s price
// (tests/presetLinking.test.mjs). Prices shown come from the live catalog.

export const PRESET_CATEGORIES = ['ALL', 'NEW', 'YOUR PHOTO', 'CINEMATIC', 'ANIME', 'FASHION', 'PRODUCTS', 'VFX', 'UGC', 'ADS'];

export const PRESETS = [
  { id: 'cctv-night', name: 'CCTV NIGHT', model: 'Wan 2.5', credits: 19, category: 'CINEMATIC', aspect: '16:9',
    bg: 'linear-gradient(180deg,#08120b 0%,#0e3a1e 60%,#2ea258 100%)', cached: true, badge: 'CACHED',
    prompt: 'Grainy night-vision security camera footage of an empty car park, a single figure crossing under a flickering sodium lamp, timestamp overlay, fixed high corner angle, faint scan lines' },
  { id: 'sunset-drift', name: 'SUNSET DRIFT', model: 'MiniMax Hailuo 02', credits: 9, category: 'CINEMATIC', aspect: '16:9',
    bg: 'linear-gradient(135deg,#2b1a0a 0%,#7a4a1e 60%,#f0b060 100%)',
    prompt: 'A vintage coupe drifting slowly round a coastal hairpin at golden hour, tyre smoke catching the low sun, camera tracking alongside at bumper height, warm film tones' },
  { id: 'neon-alley', name: 'NEON ALLEY', model: 'Kling 2.6 Pro', credits: 17, category: 'VFX', aspect: '16:9',
    bg: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)', cached: true, badge: 'CACHED',
    prompt: 'Rain-soaked neon alley at 3am, holographic signs glitching into new shapes as the camera glides past, reflections rippling in puddles, steam rising from a grate' },
  { id: 'warm-portrait', name: 'WARM PORTRAIT', model: 'Nano Banana', credits: 2, category: 'UGC', aspect: '4:5',
    bg: 'linear-gradient(160deg,#2c1a12 0%,#7a3520 60%,#c9713f 100%)',
    prompt: 'Candid portrait of a smiling person in a sunlit kitchen, soft window light, shallow depth of field, natural skin texture, shot on a 50mm lens' },
  { id: 'film-portrait', name: 'FILM PORTRAIT', model: 'Nano Banana Pro', credits: 2, category: 'CINEMATIC', aspect: '4:5',
    bg: 'linear-gradient(160deg,#120d08 0%,#4a3420 60%,#d8a868 100%)',
    prompt: 'Medium-format film portrait, subject lit by a single tungsten practical, deep shadows, visible grain, muted greens and ambers, quiet expression' },
  { id: 'talking-head', name: 'TALKING HEAD', model: 'Kling AI Avatar', credits: 35, category: 'YOUR PHOTO', aspect: '9:16',
    bg: 'linear-gradient(135deg,#0a1a2c 0%,#1e4a7a 55%,#60a0f0 100%)',
    needs: 'A clear front-facing photo of the speaker and a short voice clip',
    prompt: 'The person speaks warmly to camera, natural head movement and blinking, subtle hand gestures, soft studio background' },
  { id: 'clean-cutout', name: 'CLEAN CUTOUT', model: 'Background Removal', credits: 3, category: 'PRODUCTS',
    bg: 'linear-gradient(135deg,#1a1a0a 0%,#4a4a1e 55%,#c0c060 100%)',
    needs: 'A product photo',
    prompt: 'Remove the background' },
  { id: 'photo-to-motion', name: 'PHOTO TO MOTION', model: 'Kling 3.0 · I2V', credits: 34, category: 'YOUR PHOTO', aspect: '9:16', isNew: true,
    bg: 'linear-gradient(160deg,#101826 0%,#2a3e66 55%,#9db8f0 100%)',
    needs: 'Any photo with a clear subject',
    prompt: 'The scene comes to life: gentle wind moves hair and clothing, the camera pushes in slowly, light shifts as clouds pass' },
  { id: 'anime-hero', name: 'ANIME HERO', model: 'Seedream 4', credits: 2, category: 'ANIME', aspect: '9:16', isNew: true,
    bg: 'linear-gradient(170deg,#1a0f2e 0%,#3b2a7a 55%,#f08fc0 100%)',
    prompt: 'Hand-drawn anime key art of a young swordsman on a rooftop at dusk, wind-swept coat, cel shading, painted sky with drifting petals, dramatic low angle' },
  { id: 'anime-opening', name: 'ANIME OPENING', model: 'Seedance 2.0 Fast', credits: 28, category: 'ANIME', aspect: '16:9', isNew: true,
    bg: 'linear-gradient(135deg,#200a24 0%,#6a1e5a 55%,#ffb86b 100%)',
    prompt: '2D anime title sequence: a girl runs across a train platform as the train pulls away, quick cuts, speed lines, cherry blossoms swirling, bright saturated palette' },
  { id: 'runway-walk', name: 'RUNWAY WALK', model: 'Veo 3.1 Fast', credits: 19, category: 'FASHION', aspect: '9:16', isNew: true,
    bg: 'linear-gradient(180deg,#0d0d0d 0%,#3a3a3a 55%,#d9d0c4 100%)',
    prompt: 'A model walks a minimalist concrete runway in an oversized cream trench coat, front tracking shot, soft overhead light, audience silhouettes, fabric moving with each step' },
  { id: 'editorial-flatlay', name: 'EDITORIAL FLATLAY', model: 'Flux.2 [pro]', credits: 2, category: 'FASHION', aspect: '4:5',
    bg: 'linear-gradient(150deg,#1e1712 0%,#5c4632 55%,#e6d2b5 100%)',
    prompt: 'Top-down editorial flat lay of a capsule wardrobe on linen: knit sweater, leather loafers, gold watch, sunglasses, soft morning shadows, magazine styling' },
  { id: 'try-the-look', name: 'TRY THE LOOK', model: 'Nano Banana Pro Edit', credits: 10, category: 'YOUR PHOTO', aspect: '4:5', isNew: true,
    bg: 'linear-gradient(160deg,#1c1018 0%,#5a2a48 55%,#e8a0c8 100%)',
    needs: 'A full-length photo of yourself',
    prompt: 'Dress the person in a tailored black tuxedo with a silk lapel, keep their face, pose and the background unchanged, photoreal fabric detail' },
  { id: 'product-hero', name: 'PRODUCT HERO', model: 'Veo 3.1 Lite', credits: 10, category: 'PRODUCTS', aspect: '1:1',
    bg: 'linear-gradient(135deg,#0a1a1a 0%,#1e5a5a 55%,#7fe0d8 100%)',
    prompt: 'A glass perfume bottle rotating slowly on a wet black plinth, droplets catching rim light, slow orbiting camera, clean studio, premium commercial look' },
  { id: 'packshot-studio', name: 'PACKSHOT STUDIO', model: 'Seedream 4', credits: 2, category: 'ADS', aspect: '1:1',
    bg: 'linear-gradient(135deg,#141414 0%,#404040 55%,#f2f2f2 100%)',
    prompt: 'Studio packshot of a matte ceramic coffee mug on a seamless pastel backdrop, soft box lighting, gentle shadow, crisp edges, ready for an online store' },
  { id: 'ugc-unboxing', name: 'UGC UNBOXING', model: 'Wan 2.5', credits: 19, category: 'UGC', aspect: '9:16',
    bg: 'linear-gradient(170deg,#1a120a 0%,#5a3a1e 55%,#f0c890 100%)',
    prompt: 'Handheld phone footage of hands opening a small gift box on a bedroom desk, natural window light, slight camera shake, the reveal of a pair of wireless earbuds' },
  { id: 'portal-burst', name: 'PORTAL BURST', model: 'Kling 2.6 Pro', credits: 17, category: 'VFX', aspect: '16:9', isNew: true,
    bg: 'linear-gradient(135deg,#050a1e 0%,#1a2a7a 55%,#60f0ff 100%)',
    prompt: 'A glowing circular portal tears open in the middle of a quiet forest path, leaves and light pulled into its swirl, camera slowly dollies back, volumetric god rays' },
  { id: 'miniature-city', name: 'MINIATURE CITY', model: 'MiniMax Hailuo 02', credits: 9, category: 'VFX', aspect: '16:9',
    bg: 'linear-gradient(135deg,#0e1a0e 0%,#3a6a2a 55%,#c8f08a 100%)',
    prompt: 'Tilt-shift timelapse of a busy city crossroads that looks like a toy model, tiny cars and people streaming past, saturated colours, high vantage point' },
];

// The landing wall's seven, each with a showcase clip (showcase.js); its
// bento is shaped for exactly this many (presetWall.js).
export const WALL_PRESETS = ['cctv-night', 'sunset-drift', 'neon-alley', 'warm-portrait', 'film-portrait', 'talking-head', 'clean-cutout']
  .map((id) => PRESETS.find((p) => p.id === id));

// "New" is a flag, not a home category: a new template also sits in its own.
export function templatesIn(category) {
  if (category === 'ALL') return PRESETS;
  if (category === 'NEW') return PRESETS.filter((p) => p.isNew);
  return PRESETS.filter((p) => p.category === category);
}

export function templateById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

/** The template's own page, where its prompt and inputs are shown before use. */
export function templateHref(preset) {
  return `/presets/${encodeURIComponent(preset.id)}`;
}
