import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { templateSwapSwitchOn } from '../lib/appRuntime.js';
import { templateSwapAvailable } from '../lib/templateSwapClipGate.js';
import { id as fixtureId, registry as fixtureRegistry, manifest as fixtureManifest, catalog as fixtureCatalog } from './fixtures/templateSwapClips.mjs';

const flags = value => ({ APP_RUNTIME_FLAGS: JSON.stringify(value) });

test('the swap switch is off unless the var is exactly "true" or the runtime key is exactly true', () => {
  for (const env of [{}, flags({}), flags({ templateSwap: false }), flags({ templateSwap: 'true' }), flags({ templateSwap: 1 }),
    { APP_RUNTIME_FLAGS: '{bad' }, { TEMPLATE_SWAP_CLIP_ENABLED: 'false' }, { TEMPLATE_SWAP_CLIP_ENABLED: 'TRUE' }, undefined]) {
    assert.equal(templateSwapSwitchOn(env), false);
  }
  assert.equal(templateSwapSwitchOn(flags({ templateSwap: true })), true);
  assert.equal(templateSwapSwitchOn({ TEMPLATE_SWAP_CLIP_ENABLED: 'true' }), true);
});

test('the clip gate and the generations route read the one helper, and wrangler config is untouched', () => {
  const gate = fs.readFileSync('lib/templateSwapClipGate.js', 'utf8');
  const route = fs.readFileSync('app/api/v1/generations/route.js', 'utf8');
  assert.match(gate, /templateSwapSwitchOn\(env\)/);
  assert.match(route, /!templateSwapSwitchOn\(process\.env\)/);
  assert.doesNotMatch(gate + route, /TEMPLATE_SWAP_CLIP_ENABLED/);
  assert.doesNotMatch(fs.readFileSync('wrangler.jsonc', 'utf8'), /templateSwap/);
});

test('the gate stays closed with the runtime key absent and still needs MULTI_REFERENCE_ENABLED', () => {
  const ids = ['x'];
  for (const env of [{ MULTI_REFERENCE_ENABLED: 'true' }, flags({ templateSwap: true }), { ...flags({ templateSwap: false }), MULTI_REFERENCE_ENABLED: 'true' }]) {
    assert.equal(templateSwapAvailable('x', { env, registry: ids, manifest: { x: {} }, catalog: [] }), null);
  }
});

test('the gate opens through the runtime key alone (plus MULTI_REFERENCE_ENABLED), without the old var', () => {
  const env = { MULTI_REFERENCE_ENABLED: 'true', ...flags({ templateSwap: true }) };
  const result = templateSwapAvailable(fixtureId, { env, registry: fixtureRegistry, manifest: fixtureManifest, catalog: fixtureCatalog });
  assert.equal(result?.template.id, fixtureId);
  assert.equal(templateSwapAvailable(fixtureId, { env: flags({ templateSwap: true }), registry: fixtureRegistry, manifest: fixtureManifest, catalog: fixtureCatalog }), null);
});
