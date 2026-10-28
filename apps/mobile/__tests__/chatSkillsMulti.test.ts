import { SKILLS as ODDLING_SKILLS } from '../src/lib/oddlingsChat';
import { catalogLines, estimateInstructionTokens, fittingSkills, MAX_SELECTED_SKILLS, PREAMBLE, selectedSkillIds, skillById, skillInstructions, skillsInstructions, SKILLS } from '../src/lib/studioSkills';
import { workflowById, workflowSteps } from '../src/lib/studioWorkflows';
import type { CatalogModel } from '../src/lib/media';
const catalog: CatalogModel[] = Array.from({ length: 400 }, (_, i) => ({ id: `model-${i}`, name: 'Model', modality: i % 2 ? 'text-to-video' : 'text-to-image', credits: i + 1, gated: false, durations: [], capabilities: { inputs: { prompt: {} } } }));
test('single-skill prompts fitting both bounds retain the exact prior text', () => {
    for (const skill of SKILLS.filter(s => s.group !== 'Film')) {
        const small = catalog.slice(0, 8);
        const old = `${PREAMBLE}\n\n${skill.body}\n\nModels (id|kind|Credits per generation):\n${catalogLines(small).join('\n')}`;
        expect(skillInstructions(skill, small)).toBe(old);
    }
});
test('every Film skill obeys both limits with a large catalog', () => {
    for (const skill of SKILLS.filter(s => s.group === 'Film')) {
        const prompt = skillInstructions(skill, catalog);
        expect(prompt).toContain(skill.body); expect(prompt.length).toBeLessThanOrEqual(4000); expect(estimateInstructionTokens(prompt)).toBeLessThanOrEqual(1000);
    }
});
test('selection round-trips pick order, workflow order and ignores custom/persona instructions', () => {
    const picks = [skillById('storyboard')!, skillById('prompt-writer')!];
    const ids = selectedSkillIds(skillsInstructions(picks, catalog));
    expect(ids).toEqual(picks.map(s => s.id)); expect(skillById(ids[0])?.starter).toBe(picks[0].starter);
    const steps = workflowSteps(workflowById('viral-short')!);
    expect(selectedSkillIds(skillsInstructions(steps, catalog))).toEqual(steps.map(s => s.id));
    expect(selectedSkillIds('custom ' + picks[0].body)).toEqual([]); expect(selectedSkillIds(null)).toEqual([]);
});
test('whole skills only, four maximum, and both budgets for long combinations', () => {
    expect(MAX_SELECTED_SKILLS).toBe(4);
    const chosen = SKILLS.slice(0, 5); const kept = fittingSkills(chosen, catalog);
    expect(kept.length).toBeLessThanOrEqual(4);
    const prompt = skillsInstructions(chosen, catalog);
    expect(prompt.length).toBeLessThanOrEqual(4000); expect(estimateInstructionTokens(prompt)).toBeLessThanOrEqual(1000);
    kept.forEach(s => expect(prompt).toContain(s.body));
    const huge = { ...chosen[0], body: '漢'.repeat(1200) };
    expect(fittingSkills([huge], catalog)).toEqual([]);
});

test('Oddling continuity shares the hand-off instruction body', () => {
    expect(skillById('oddling-continuity')!.body).toBe(ODDLING_SKILLS[0].body);
});
