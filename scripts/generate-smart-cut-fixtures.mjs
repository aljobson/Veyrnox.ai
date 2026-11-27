import fs from 'node:fs';
import { buildSpeechAwareCutPlan } from '../app/veyrnox/_lib/smartCutAnalysis.js';

const inputUrl = new URL('../packages/smart-cut-fixtures/corpus.v1.inputs.json', import.meta.url);
const outputUrl = new URL('../packages/smart-cut-fixtures/corpus.v1.expected.json', import.meta.url);
const corpus = JSON.parse(fs.readFileSync(inputUrl, 'utf8'));
const output = {
  schemaVersion: corpus.schemaVersion,
  fixtures: corpus.fixtures.map(({ id, input }) => ({ id, expected: buildSpeechAwareCutPlan(input) })),
};
fs.writeFileSync(outputUrl, `${JSON.stringify(output, null, 2)}\n`);
