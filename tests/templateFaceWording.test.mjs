import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayload } from '../packages/adapters/fal.js';
import { TEMPLATE_FACE_WORDING as full, TEMPLATE_FACE_WORDING_COMPACT as compact } from '../lib/templateFaceWording.mjs';
import { TEMPLATE_SWAP_CLIP_PROMPT } from '../lib/templateSwapClipPrompt.mjs';
const endpoint = 'fal-ai/kling-video/v3/pro/image-to-video';
function payload(prompt, faceIdentity = true, provider_endpoint = endpoint) {
  return buildPayload({ job_id: 'test-job', provider_endpoint, inputs: Object.freeze({ prompt, start_image_url: 'photo', duration: '5' }) }, { faceIdentity });
}
test('submit-only wording uses full then compact budget without truncating input', () => {
  assert.equal(payload('A portrait.').prompt, `A portrait. ${full}`);
  assert.equal(payload('x'.repeat(2000 - full.length - 1)).prompt.length, 2000);
  const near = 'x'.repeat(2000 - compact.length - 1);
  assert.equal(payload(near).prompt, `${near} ${compact}`);
  assert.equal(payload('original', false).prompt, 'original');
  assert.equal(payload('original', true, 'fal-ai/unrelated').prompt, 'original');
  assert.deepEqual(payload('original', false), { prompt: 'original', start_image_url: 'photo', duration: '5' });
});
test('no room or already over limit preserves all bytes and logs the omission', t => {
  const logs = []; t.mock.method(console, 'warn', (...args) => logs.push(args));
  for (const length of [2000 - compact.length, 2000, 5814]) {
    const original = 'x'.repeat(length);
    assert.equal(payload(original).prompt, original);
  }
  assert.deepEqual(logs, Array.from({ length: 3 }, () => ['face_wording_omitted_length', 'test-job']));
});
test('O1 wording stays byte-identical and is not appended twice', () => {
  assert.equal(payload(TEMPLATE_SWAP_CLIP_PROMPT, true, 'fal-ai/kling-video/o1/video-to-video/reference').prompt, TEMPLATE_SWAP_CLIP_PROMPT);
  assert.equal(TEMPLATE_SWAP_CLIP_PROMPT.split(full).length, 2);
});

test('an empty prompt gets the wording without a leading space', () => {
  assert.equal(templateFacePrompt(''), TEMPLATE_FACE_WORDING);
  assert.equal(templateFacePrompt('   '), TEMPLATE_FACE_WORDING);
});
