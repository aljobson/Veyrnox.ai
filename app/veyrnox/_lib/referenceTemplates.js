// Original video restyling recipes. Picture order is part of the prompt contract.
const COMMON = {
  model: 'Kling O1 · Reference',
  credits: 47,
  durationSeconds: 5,
  promptOrigin: 'veyrnox-adaptation',
  needsKey: 'reference.video-two-pictures',
  needs: 'One video (3–10 s, at least 720p) and two reference pictures',
  steps: [
    'Use this template to load its prompt and settings in the studio.',
    'Review the framing and identity details before generating.',
    'Generate a 5s or 10s shot, or continue in Film Studio for a longer multi-shot film.',
  ],
};

export const REFERENCE_TEMPLATES = [
  {
    ...COMMON, id: 'ref-paper-landscape', name: 'PAPER LANDSCAPE', category: 'CARTOONS',
    prompt: 'Restyle the source video as a layered paper landscape. Use @Image1 for the paper textures, folded edges and material finish, and @Image2 for the landscape palette and soft lighting. Preserve the original camera path, subject positions and timing while turning surfaces into carefully cut paper forms. Keep depth and shadows consistent throughout the shot, with smooth motion and no added text.',
  },
  {
    ...COMMON, id: 'ref-ceramic-studio', name: 'CERAMIC STUDIO', category: 'PRODUCTS',
    prompt: 'Restyle the object and setting in the source video as a handcrafted ceramic studio scene. Use @Image1 for the glaze colour, subtle surface texture and ceramic finish. Use @Image2 for the studio backdrop and lighting direction. Preserve the object silhouette, camera movement and sequence of actions from the video. Maintain stable reflections and contact shadows as the camera moves, without adding lettering or extra objects.',
  },
  {
    ...COMMON, id: 'ref-watercolour-garden', name: 'WATERCOLOUR GARDEN', category: 'FANTASY',
    prompt: 'Restyle the source video as a moving watercolour garden. Use @Image1 to guide the pigment texture, soft edges and brushwork, and @Image2 to guide the botanical colours and atmosphere. Retain the source camera movement, scene layout and subject timing. Let painted foliage and translucent washes follow the existing shapes, keeping edges stable between frames and preserving clear depth without abrupt transitions.',
  },
  {
    ...COMMON, id: 'ref-nocturnal-glass', name: 'NOCTURNAL GLASS', category: 'CINEMATIC',
    prompt: 'Restyle the source video into an atmospheric night scene with sculpted glass surfaces. Use @Image1 for the glass tint, surface finish and refraction treatment, and @Image2 for the night palette and placement of soft lights. Preserve the source composition, camera trajectory and motion. Keep reflections attached to their surfaces and retain readable silhouettes across the whole shot, without introducing signs or text.',
  },
  {
    ...COMMON, id: 'ref-woven-world', name: 'WOVEN WORLD', category: 'VFX',
    prompt: 'Restyle the source video as a miniature world made of woven fabric. Use @Image1 for the thread thickness, weave and textile texture, and @Image2 for the colour arrangement and warm lighting. Preserve the video camera motion, scene geometry and action timing. Apply the fabric treatment consistently to existing surfaces, with stable stitching, believable soft shadows and no flickering patterns or new text.',
  },
  {
    ...COMMON, id: 'ref-sunlit-stone', name: 'SUNLIT STONE', category: 'REALISTIC',
    prompt: 'Restyle the source video as a quiet scene of pale stone in natural sunlight. Use @Image1 for the stone grain, matte finish and fine surface detail, and @Image2 for the sun direction, surrounding colours and atmospheric warmth. Preserve the camera path, object proportions and all movement from the source video. Keep shadows and material detail coherent as the view changes, with a restrained photographic finish and no added text.',
  },
];
