import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGISTRY, checkInputs } from '../lib/modelCapabilities.js';
import { validateInputs } from '../lib/generationInputValidation.js';
import { GENERATION_ASPECT_RATIOS } from '../lib/generationAspectRatios.js';
import { ASPECT_RATIOS } from '../app/veyrnox/_lib/tokens.js';

const declared = new Set(Object.values(REGISTRY).flatMap((record) => record.inputs?.aspect_ratio?.values || []));

test('the gateway accepts every shape a model declares', () => {
  for (const [endpoint, record] of Object.entries(REGISTRY)) {
    for (const aspect of record.inputs?.aspect_ratio?.values || []) {
      assert.deepEqual(validateInputs({ prompt: 'p', aspect_ratio: aspect }), { ok: true }, `${endpoint} ${aspect}`);
    }
  }
});

test('the gateway list holds only shapes some model declares', () => {
  assert.deepEqual([...GENERATION_ASPECT_RATIOS].sort(), [...declared].sort());
  assert.equal(new Set(GENERATION_ASPECT_RATIOS).size, GENERATION_ASPECT_RATIOS.length);
});

test('every shape the Create picker can show passes the gateway', () => {
  for (const aspect of ASPECT_RATIOS) {
    assert.deepEqual(validateInputs({ prompt: 'p', aspect_ratio: aspect }), { ok: true }, aspect);
  }
});

test('the gateway still refuses a shape no model declares, and the model contract still narrows', () => {
  for (const aspect of ['7:5', '2:1', '', 'AUTO', 16 / 9, null]) {
    assert.deepEqual(validateInputs({ prompt: 'p', aspect_ratio: aspect }), { ok: false, error: 'inputs_invalid:aspect_ratio' }, String(aspect));
  }
  const narrow = Object.entries(REGISTRY).find(([, record]) => {
    const values = record.inputs?.aspect_ratio?.values;
    return values && !values.includes('2:3');
  });
  assert.ok(narrow, 'a model without 2:3 exists');
  assert.equal(checkInputs(narrow[1], { prompt: 'p', aspect_ratio: '2:3' }).ok, false, narrow[0]);
});

test('the MCP image and video tools use the gateway list', () => {
  const source = readFileSync(new URL('../lib/veyrnoxMcp.js', import.meta.url), 'utf8');
  assert.equal(source.match(/aspect_ratio: z\.enum\(GENERATION_ASPECT_RATIOS\)\.optional\(\)/g)?.length, 2);
  assert.doesNotMatch(source, /aspect_ratio: z\.enum\(\[/);
});
