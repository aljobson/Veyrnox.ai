import { SYNTX_100_IMAGE_RECORDS } from './syntx100ImageRecords.js';
// Captured from the Syntx public feed, 2026-11-12. Prompt bytes are hash-locked in tests.
export const IMAGE_SOURCE_PROMPT_RECORDS = Object.freeze({
  ...SYNTX_100_IMAGE_RECORDS,
  'flying-elf': Object.freeze({
  "sourcePromptAvailable": true,
  "sourceAuditStatus": "captured-2026-11-12",
  "sourceTitle": "Flying Elf",
  "sourceRecordId": "01a011a9-b028-7328-8f39-4eca02bd4ec4",
  "sourceSlug": "flying-elf",
  "sourceUrl": "https://api.syntx.ai/api/v1/trends",
  "sourceModel": "banana2",
  "sourceAspect": "16:9",
  "promptSha256": "8adc8eaedc6089dd5703d4a5a99b104c568436299b1d8388aa78c9a53e8c20ab",
  "prompt": "Create an ultra-hyperrealistic action image of an elf flying through the air after a huge explosion. The elf should look shocked and scream, with his eyes wide open and his beard and clothes blown backwards by the shock wave. The explosion behind him should be a massive fireball with sparks, debris, and thick smoke. The light from the explosion should dramatically illuminate the elf's face and the detailed textures of his clothes and beard. In the background, his destroyed sleigh should fly through the air in several pieces, along with reindeer that are also thrown out by the explosion – caught in the middle of the chaos, in realistic positions and with dramatic lighting. The atmosphere should be intense, cinematic, and extremely realistic, like a scene from a big-budget action movie."
}),
  'christmas-tree-ornament': Object.freeze({
  "sourcePromptAvailable": true,
  "sourceAuditStatus": "captured-2026-11-13",
  "sourceTitle": "Christmas Tree Ornament",
  "sourceRecordId": "01a1cb5f-c1b3-7030-b572-c82fbba8b92c",
  "sourceSlug": "christmas-tree-ornament",
  "sourceUrl": "https://api.syntx.ai/api/v1/trends",
  "sourceModel": "banana",
  "sourceGenerationSettings": {
    "n": 1,
    "image_size": "2K",
    "model_type": "banana-2.1",
    "aspect_ratio": "3:4",
    "thinking_level": "medium"
  },
  "sourcePublishedAt": "2026-11-11T19:06:00Z",
  "sourceAspect": "3:4",
  "promptSha256": "1082539cb0da501164497e48479807657804cd60042ed6902e00127ac4750129",
  "prompt": "Transform the subject from the reference image into a hyper-realistic luxury Christmas tree ornament. Preserve their identity exactly: same face, facial features, hairstyle, hair color, skin tone, outfit, colors, accessories and overall pose/gesture from the reference. Keep any held objects from the reference.\n\nProportions: if the subject is a person, character or animal, give the ornament stylized collectible-toy proportions: an intentionally oversized head (about 1/3 of the total body height, noticeably larger than realistic) and enlarged, chunky wrists and hands, while the torso and legs stay compact. The head must still look like the same person, with the face fully recognizable. If the subject is an inanimate object, keep its original proportions unchanged.\n\nThe ornament is a premium collectible figurine made of hand-painted resin with a smooth matte finish: soft non-reflective surface, no gloss, no lacquer shine, fine brush-painted details, crisp edges. The face is incredibly realistic, with detailed facial features, expressive eyes and natural skin texture, while the body and clothing clearly read as a high-end painted ornament.\n\nThe full figure is shown head to toe, centered in the frame, hanging from a thin gold thread attached to a small gold loop fixed either on the very top of the head or directly on the upper back behind it, with the attachment clearly visible: the thread is tied through the loop and rises straight up. The loop is never placed on the face, forehead, chest or front of the ornament. Background: a softly blurred Christmas tree with dark green needles, out-of-focus red and gold glass baubles, and warm golden bokeh from fairy lights. Cozy, festive, magical atmosphere. Shallow depth of field, soft warm lighting, rich festive colors. High-resolution macro photography, ultra-detailed, cinematic look, vertical 3:4 composition."
}),
});
