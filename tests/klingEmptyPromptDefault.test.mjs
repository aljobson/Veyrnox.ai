import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { DEFAULT_MOTION_PROMPT } from '../lib/additionalModelCapabilities.js';
import { buildRequest, parseEndpoint } from '../packages/adapters/crun.js';

// QA build 68: Kling 3.0 Standard (served by Crun) with a photo and an empty prompt "could not start", while the page
// labels the prompt optional. The adapters refuse an empty prompt after the debit, so the gateway fills it instead.
const ENDPOINTS = ['market:kling-3.0/video-std', 'market:kling-3.0/video', 'crun:kling/v3', 'crun:kling/v3-std', 'higgsfield:kling-video/v3.0/pro/image-to-video'];

test('every photo-to-video Kling record that requires a prompt carries a default motion prompt', () => {
  for (const endpoint of ENDPOINTS) {
    const record = capabilityFor(endpoint);
    assert.equal(record?.defaultPrompt, DEFAULT_MOTION_PROMPT, endpoint);
    assert.equal(record.inputs.prompt.required, true, `${endpoint} still requires one`);
  }
});

test('the default is a real prompt the Crun builder accepts, while an empty one is refused', () => {
  const target = parseEndpoint('crun:kling/v3-std');
  const image_url = 'https://example.com/a.png';
  assert.deepEqual(buildRequest(target, { prompt: '', image_url }), { ok: false, error: 'prompt_required' });
  const built = buildRequest(target, { prompt: DEFAULT_MOTION_PROMPT, image_url });
  assert.equal(built.ok, true);
  assert.equal(built.body.input.prompt, DEFAULT_MOTION_PROMPT);
});

test('the gateway fills a blank prompt before the provider check and the debit', () => {
  const route = readFileSync('app/api/v1/generations/route.js', 'utf8');
  const fill = route.indexOf('record.defaultPrompt');
  assert.ok(fill > 0);
  assert.ok(fill < route.indexOf('provider.check(record, modelRow, modelInputs)'));
  const debit = route.indexOf("'ledger_debit'", route.indexOf('const providerCheck'));
  assert.ok(debit > 0, 'the debit call is found after the provider check');
  assert.ok(fill < debit, 'the prompt is filled before the debit')
  assert.match(route, /!\(typeof inputs\.prompt === 'string' && inputs\.prompt\.trim\(\)\)/);
});
