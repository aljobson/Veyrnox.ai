import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_SWAP_CLIP_PROMPT } from '../lib/templateSwapClipPrompt.mjs';
import { TEMPLATE_FACE_WORDING } from '../lib/templateFaceWording.mjs';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { TEMPLATE_SWAP_CLIP_ENDPOINT } from '../app/veyrnox/_lib/templateSwapClips.js';

test('the swap wording is the tested face-fidelity text plus the background clause, generic and within the prompt limit', () => {
  assert.equal(TEMPLATE_SWAP_CLIP_PROMPT, "Replace the main character in the video with the person in the reference image or images. The new person's face must match the reference exactly: same face shape, jawline, forehead, nose, lips, eye shape, skin tone, hairline, hair and facial hair, and the same natural expression character. Do not slim, smooth, retouch, beautify or idealise the face, and do not change the person's age or features. Keep the same body build and clothing as in the reference. Use the reference image only for the person: ignore its background, setting and lighting completely. Keep the video's scene, background, camera, lighting, motion and timing unchanged.");
  assert.equal(TEMPLATE_SWAP_CLIP_PROMPT.length, 642);
  const max = capabilityFor(TEMPLATE_SWAP_CLIP_ENDPOINT).inputs.prompt.max;
  assert.ok(max >= 2000 && TEMPLATE_SWAP_CLIP_PROMPT.length <= 2000 && TEMPLATE_SWAP_CLIP_PROMPT.length <= max);
  assert.doesNotMatch(TEMPLATE_SWAP_CLIP_PROMPT, /@(?:Image|Video)\s*\d|<<<|[<>{}]/);
});

test('the clause that keeps the photo background out of the scene is present and the face wording is unchanged', () => {
  assert.match(TEMPLATE_SWAP_CLIP_PROMPT, /Use the reference image only for the person: ignore its background, setting and lighting completely\./);
  assert.match(TEMPLATE_SWAP_CLIP_PROMPT, /Keep the video's scene, background, camera, lighting, motion and timing unchanged\.$/);
  assert.ok(TEMPLATE_SWAP_CLIP_PROMPT.includes(TEMPLATE_FACE_WORDING));
});
