import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildSpeechAwareCutPlan } from '../app/veyrnox/_lib/smartCutAnalysis.js';

const inputs = JSON.parse(fs.readFileSync(new URL('../packages/smart-cut-fixtures/corpus.v1.inputs.json', import.meta.url), 'utf8'));
const expected = JSON.parse(fs.readFileSync(new URL('../packages/smart-cut-fixtures/corpus.v1.expected.json', import.meta.url), 'utf8'));

test('the canonical Smart Cut golden corpus is deterministic and current', () => {
  assert.equal(inputs.schemaVersion, expected.schemaVersion);
  assert.deepEqual(inputs.fixtures.map((fixture) => fixture.id), expected.fixtures.map((fixture) => fixture.id));
  inputs.fixtures.forEach((fixture, index) => {
    assert.deepEqual(buildSpeechAwareCutPlan(fixture.input), expected.fixtures[index].expected, fixture.id);
  });
});

test('the baseline corpus preserves notes and complete timed-unit boundaries', () => {
  const byId = Object.fromEntries(expected.fixtures.map((fixture) => [fixture.id, fixture.expected]));
  assert.equal(byId['multi-take-script-and-notes'].notes, 'Prefer the cleanest complete take.');
  assert.equal(byId['multi-take-script-and-notes'].scriptProvided, true);
  assert.deepEqual(byId['multi-take-script-and-notes'].segments.map((segment) => segment.matchCode), ['script_line_matched', 'script_line_matched']);
  assert.equal(byId['multi-take-script-and-notes'].warningDetails.find((warning) => warning.code === 'extra_speech_omitted').parameters.count, 1);
  assert.equal(byId['complete-word-output-cap'].segments.at(-1).label, 'Main');
  assert.equal(byId['complete-word-output-cap'].segments.at(-1).end, 59);
  assert.ok(byId['trim-boundary-complete-unit'].warningDetails.some((warning) => warning.code === 'trim_intersects_unit'));
  assert.equal(byId['no-script-repeated-takes'].segments.length, 1);
  assert.equal(byId['no-script-repeated-takes'].segments[0].takeId, 'take-two');
  assert.deepEqual(byId['no-script-repeated-takes'].segments[0].alternates, ['take-one']);
  assert.equal(byId['no-script-repeated-takes'].warningDetails.find((warning) => warning.code === 'retake_omitted').parameters.count, 1);
});
