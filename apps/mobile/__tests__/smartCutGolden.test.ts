import fs from 'node:fs';
import path from 'node:path';
import { buildSpeechAwareCutPlan, type SmartCutPacing, type SmartCutSource } from '../src/lib/smartCut';
import type { SpeechAnalysis } from '../src/lib/speechCut';

type FixtureInput = {
    clips: SmartCutSource[];
    analyses: Record<string, SpeechAnalysis>;
    script?: string;
    notes?: string;
    silencePreset?: SmartCutPacing;
};

const repo = path.resolve(__dirname, '../../..');
const inputs = JSON.parse(fs.readFileSync(path.join(repo, 'packages/smart-cut-fixtures/corpus.v1.inputs.json'), 'utf8')) as {
    schemaVersion: number;
    fixtures: { id: string; input: FixtureInput }[];
};
const expected = JSON.parse(fs.readFileSync(path.join(repo, 'packages/smart-cut-fixtures/corpus.v1.expected.json'), 'utf8')) as {
    schemaVersion: number;
    fixtures: { id: string; expected: unknown }[];
};

test('mobile executes the canonical web Smart Cut golden plans byte for byte', () => {
    expect(inputs.schemaVersion).toBe(expected.schemaVersion);
    expect(inputs.fixtures.map((fixture) => fixture.id)).toEqual(expected.fixtures.map((fixture) => fixture.id));
    inputs.fixtures.forEach((fixture, index) => {
        const { silencePreset, ...input } = fixture.input;
        const plan = buildSpeechAwareCutPlan({ ...input, pacing: silencePreset });
        expect(JSON.stringify(plan)).toBe(JSON.stringify(expected.fixtures[index].expected));
    });
});
