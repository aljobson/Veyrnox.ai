import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseProbe } from '../scripts/probe-crun.mjs';
import { parseEndpoint } from '../packages/adapters/crun.js';

test('every probe maps to an endpoint the adapter parses', () => {
  for (const name of ['veo-lite', 'veo-fast', 'seedance-fast']) {
    const r = chooseProbe([name]);
    assert.equal(r.ok, true);
    assert.ok(parseEndpoint(r.probe.endpoint), name);
  }
});
test('the dear probe needs --yes and an unknown name is refused', () => {
  assert.equal(chooseProbe(['veo']).ok, false);
  assert.equal(chooseProbe(['veo', '--yes']).ok, true);
  assert.equal(chooseProbe(['nope']).ok, false);
  assert.equal(chooseProbe([]).ok, false);
});
