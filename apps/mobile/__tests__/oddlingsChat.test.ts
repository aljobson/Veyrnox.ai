declare const __dirname: string;
import { ODDLINGS } from '../src/lib/oddlings';
import { GROUPS, MOTIONS } from '../src/lib/oddlingsBuilder';
import { oddlingCanon, oddlingChatInstructions, parseOddlingInstructions, nextOddlingInstructions, SKILLS, PREAMBLE, estimateInstructionTokens, catalogLines } from '../src/lib/oddlingsChat';
import { SKILLS as PHONE_SKILLS, skillsInstructions as oldInstructions, selectedSkillIds } from '../src/lib/studioSkills';
import type { CatalogModel } from '../src/lib/media';
const { spawnSync } = require('child_process');
const { resolve } = require('path');
const models: CatalogModel[] = [{ id: 'image', name: 'Image', modality: 'text-to-image', credits: 6, durations: [], gated: false, bestValue: true, capabilities: { inputs: { prompt: {} } } }];
const input = { picks: { oddling_name: 'Pip', hair: 'Bald' }, scene: 'A tiny stage', referenceNote: 'Red light' };
const inputs = [...ODDLINGS.map(o => ({ ...input, picks: o.picks, mode: 'motion', motionId: MOTIONS[1].id })), { ...input, picks: Object.fromEntries(GROUPS.map(g => [g.id, g.options[0][0]])) }];
const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
import { oddlingCanonInstructions } from './app/veyrnox/_lib/oddlingChatHandoff.js';
import { skillsInstructions, fittingSkillsWithRequired, SKILLS } from './app/veyrnox/_lib/studioSkills.js';
const inputs = ${JSON.stringify(inputs)};
const selected = ['oddling-continuity','storyboard','prompt-writer','bring-to-life'].map(id=>SKILLS.find(s=>s.id===id));
const canon = oddlingCanonInstructions({...${JSON.stringify(input)},ownerId:'test-owner',savedAt:1700000000000});
console.log(JSON.stringify({canons:inputs.map(i=>oddlingCanonInstructions({...i,ownerId:'test-owner',savedAt:1700000000000})),empty:skillsInstructions(fittingSkillsWithRequired(selected,[],canon,'oddling-continuity'),[],canon)}));
`], { cwd: resolve(__dirname, '../../..'), encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
const web = JSON.parse(run.stdout);
test('nonempty canon equals the web for every cast member and all visual groups', () => {
    expect(run.status).toBe(0);
    inputs.forEach((value, index) => { const canon = oddlingCanon(value); expect(canon).not.toBe(''); expect(canon).toBe(web.canons[index]); });
    expect(oddlingCanon({ picks: {} })).toBe('');
});
test('launch keeps continuity first and respects both budgets', () => {
    const prompt = oddlingChatInstructions(input, models);
    expect(prompt.startsWith(PREAMBLE)).toBe(true);
    expect(prompt.indexOf(SKILLS[0].body)).toBeLessThan(prompt.indexOf(SKILLS[1].body));
    expect(prompt.length).toBeLessThanOrEqual(4000); expect(estimateInstructionTokens(prompt)).toBeLessThanOrEqual(1000);
    expect(catalogLines(models)).toEqual(['image|image|6|best value']);
    const huge = Object.fromEntries(GROUPS.map(g => [g.id, g.options.reduce((a, b) => a[0].length > b[0].length ? a : b)[0]]));
    expect(oddlingChatInstructions({ picks: { ...huge, oddling_name: '界'.repeat(40), oddling_obsession: '界'.repeat(140), oddling_rule: '界'.repeat(160) }, scene: '界'.repeat(300), referenceNote: '界'.repeat(180) }, models)).toBe('');
});
test('reader handles a catalog header with and without its trailing newline', () => {
    const parsed = parseOddlingInstructions(oddlingChatInstructions(input, models));
    expect(parsed?.canon).toBe(oddlingCanon(input));
    expect(parsed?.skillIds).toEqual(SKILLS.map(s => s.id));
    expect(parseOddlingInstructions(oddlingChatInstructions(input, []))).toEqual(parsed);
    expect(parseOddlingInstructions(web.empty)).toEqual(parsed);
    expect(selectedSkillIds(oddlingChatInstructions(input, models))).toEqual(['oddling-continuity', 'storyboard', 'prompt-writer', 'bring-to-life']);
});
test('old-format skill detection is unchanged for every card and multiple cards', () => {
    for (const skills of [...PHONE_SKILLS.map(s => [s]), PHONE_SKILLS.slice(0, 3)]) {
        const prompt = oldInstructions(skills, models);
        const expected = PHONE_SKILLS.map(s => ({ id: s.id, at: prompt.indexOf(s.body) })).filter(s => s.at >= 0).sort((a,b)=>a.at-b.at).slice(0,4).map(s=>s.id);
        expect(selectedSkillIds(prompt)).toEqual(expected);
    }
    expect(selectedSkillIds('plain prompt')).toEqual([]);
});
test('optional toggles preserve canon and continuity; other skills are locked', () => {
    let prompt = oddlingChatInstructions(input, models);
    for (const catalog of [[], models]) {
        const next = nextOddlingInstructions(prompt, 'storyboard', catalog);
        expect(next && 'instructions' in next).toBe(true);
        if (next && 'instructions' in next) prompt = next.instructions;
        expect(parseOddlingInstructions(prompt)?.canon).toBe(oddlingCanon(input));
        expect(parseOddlingInstructions(prompt)?.skillIds[0]).toBe('oddling-continuity');
    }
    expect(nextOddlingInstructions(prompt, 'model-picker', models)).toEqual({ error: 'locked' });
    expect(nextOddlingInstructions('ordinary', 'storyboard', models)).toBeNull();
});
