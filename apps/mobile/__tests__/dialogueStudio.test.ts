import { addDialogueTurn, removeDialogueTurn, normalizeDialogueTurns, validateDialogue, buildDialogueRequest, dialogueModel, restoreDialogue } from '../src/lib/speech/dialogue';
import * as shared from '../src/lib/speech/dialogueShared';
import { editedDialogueCast } from '../src/lib/speech/dialogueEditing';
import { restoreSpeech } from '../src/lib/speech/restore';
import { buildSpeechRequest } from '../src/lib/speech/studio';
import { DEFAULT_TTS_SETTINGS } from '../src/lib/speech/shared';
import { SPEECH_MODEL_ID } from '../src/lib/speech/model';
import type { CatalogModel } from '../src/lib/media';
// @ts-ignore shared gateway contract
import { DIALOGUE_INPUT_RULES } from '../../../lib/speechInputs.js';
// @ts-ignore web authority
import * as web from '../../../app/veyrnox/_lib/dialogueStudio.js';
const model: CatalogModel = { id: shared.DIALOGUE_MODEL_ID, name: 'Dialogue', modality: 'text-to-audio', credits: 6, gated: false, durations: [], capabilities: { inputs: { prompt: {} } } };
const turns = [{ speaker: 'Ana', text: 'Hello' }, { speaker: 'Ben', text: 'Hi' }];
const cast = shared.resolveDialogueCastAssignments(turns, []);
const validate = (value: shared.DialogueTurn[]) => validateDialogue(value, shared.resolveDialogueCastAssignments(value, []));
test('seam pins the web functions, stock voices and gateway hidden inputs', () => {
    expect(shared.validateDialogueTurns).toBe(web.validateDialogueTurns);
    expect(shared.MAX_DIALOGUE_CHARS).toBe(1000);
    expect(shared.DIALOGUE_VOICES).toBe(web.DIALOGUE_VOICES);
    expect(Object.values(DIALOGUE_INPUT_RULES)).toEqual(shared.DIALOGUE_VOICES.map(() => ({ type: 'enum', values: shared.DIALOGUE_VOICES, hidden: true })));
});
test('normalization prevents newline speaker injection and collapses all whitespace', () => {
    const input = [{ speaker: ' Ana ', text: 'Hello\r\nBen: hello\t there\u2028 again' }, turns[1]];
    const normalized = normalizeDialogueTurns(input);
    expect(normalized[0]).toEqual({ speaker: 'Ana', text: 'Hello Ben: hello there again' });
    const request = buildDialogueRequest(input, cast, model);
    expect(shared.parseDialogue(request.prompt!, shared.dialogueVoiceOrder(request.extraInputs))).toEqual({ ok: true, blocks: [
        { voice: cast[0].voice, text: normalized[0].text }, { voice: cast[1].voice, text: 'Hi' },
    ] });
});
test('turn operations preserve the web alternating speaker and enforce 2 / 12 limits', () => {
    expect(addDialogueTurn(turns).at(-1)).toEqual({ speaker: 'Ana', text: '' });
    expect(removeDialogueTurn(turns, 0)).toEqual(turns);
    expect(removeDialogueTurn([...turns, turns[0]], 1)).toEqual([turns[0], turns[0]]);
    const twelve = Array.from({ length: 12 }, (_, i) => turns[i % 2]);
    expect(addDialogueTurn(twelve)).toEqual(twelve);
    expect(validate(twelve)).toBeNull(); expect(validate([...twelve, turns[0]])).toBe('dialogue.turnLimit');
    expect(validate([turns[0]])).toBe('dialogue.turnLimit');
    expect(shared.moveDialogueTurn(turns, 0, -1)).toEqual(turns);
});
test('two and four speakers are accepted; reuse is case-insensitive; a fifth fails', () => {
    expect(validate(turns)).toBeNull();
    const four = [...turns, { speaker: 'Cat', text: 'C' }, { speaker: 'Dan', text: 'D' }];
    expect(validate(four)).toBeNull();
    expect(validate([...four, { speaker: 'Eve', text: 'E' }])).toBe('dialogue.speakerLimit');
    expect(validate([{ speaker: 'ana', text: 'A' }, turns[0]])).toBe('dialogue.speakerLimit');
    expect(shared.resolveDialogueCastAssignments([...turns, { speaker: 'ANA', text: 'Again' }], cast)).toEqual(cast);
});
test('exact 1000 character compiled boundary and invalid speaker names', () => {
    const atLimit = [{ speaker: 'Ana', text: 'x'.repeat(987) }, { speaker: 'Ben', text: 'ok' }];
    expect(shared.compileDialogueTurns(atLimit)).toHaveLength(1000);
    expect(validate(atLimit)).toBeNull();
    expect(validate([{ ...atLimit[0], text: atLimit[0].text + 'x' }, atLimit[1]])).toBe('dialogue.tooLong');
    expect(validate([{ speaker: 'x'.repeat(30), text: 'A' }, turns[1]])).toBeNull();
    expect(validate([{ speaker: 'x'.repeat(31), text: 'A' }, turns[1]])).toBe('dialogue.invalid');
    expect(validate([{ speaker: '1Ana', text: 'A' }, turns[1]])).toBe('dialogue.invalid');
    expect(validate([{ speaker: 'Ana', text: '' }, turns[1]])).toBe('dialogue.wordsRequired');
});
test('moving first appearance preserves displayed voices and refuses mismatched or duplicate casts', () => {
    const moved = shared.moveDialogueTurn(turns, 0, 1);
    expect(validateDialogue(moved, cast)).toBe('dialogue.castInvalid');
    const reordered = shared.resolveDialogueCastAssignments(moved, cast);
    const request = buildDialogueRequest(moved, reordered, model);
    expect(request.extraInputs).toEqual({ dialogue_voice_1: 'Roger', dialogue_voice_2: 'Aria' });
    expect(validateDialogue(turns, [cast[0], { ...cast[1], voice: cast[0].voice }])).toBe('dialogue.castInvalid');
    expect(validateDialogue(turns, [])).toBe('dialogue.castInvalid');
});
test('only the exact supported audio model can open the studio', () => {
    expect(dialogueModel([model])).toEqual(model);
    for (const bad of [{ ...model, id: 'elevenlabs-dialogue-kie' }, { ...model, gated: true }, { ...model, credits: NaN }, { ...model, credits: -1 }, { ...model, modality: 'image' }]) expect(dialogueModel([bad])).toBeNull();
});
test('restoration recovers exact names, order, text and per-job voices', () => {
    const original = [...turns, { speaker: 'ANA', text: 'Again' }];
    const chosen = [{ speaker: 'Ana', voice: 'George' }, { speaker: 'Ben', voice: 'Sarah' }];
    const request = buildDialogueRequest(original, chosen, model);
    expect(restoreDialogue(request)).toEqual({ turns: original, assignments: chosen });
    for (const bad of [
        { ...request, prompt: 'Ana: Hello\ncontinued\nBen: Hi' },
        { ...request, prompt: 'Ana:  Hello\nBen: Hi' },
        { ...request, extraInputs: { dialogue_voice_1: 'George', dialogue_voice_2: 'George' } },
        { ...request, extraInputs: { dialogue_voice_2: 'George' } },
        { ...request, extraInputs: {} }, { ...request, extraInputs: undefined },
        { ...request, prompt: '' }, { ...request, modelId: 'wrong' },
    ]) expect(restoreDialogue(bad)).toBeNull();
});
test('speech restoration validates all six saved controls, including audition per-job voice', () => {
    const settings = { ...DEFAULT_TTS_SETTINGS, voice: 'Wise_Woman', speed: 1.2, volume: 2, pitch: 3 };
    const request = buildSpeechRequest('Hello', settings, { ...model, id: SPEECH_MODEL_ID });
    expect(restoreSpeech(request)).toEqual({ script: 'Hello', settings });
    for (const key of Object.keys(request.extraInputs!)) {
        const extraInputs = { ...request.extraInputs }; delete extraInputs[key];
        expect(restoreSpeech({ ...request, extraInputs })).toBeNull();
    }
    expect(restoreSpeech({ ...request, extraInputs: { ...request.extraInputs, tts_speed: '1' } })).toBeNull();
});


test('R04: editing keeps only active names, leaves saved preferences intact, and reserves existing voices', () => {
    const preferences = Array.from({ length: 24 }, (_, i) => ({ speaker: `Saved${i}`, voice: 'Sarah' }));
    const snapshot = JSON.stringify(preferences);
    let previous = turns;
    let assignments = [{ speaker: 'Ana', voice: 'George' }, { speaker: 'Ben', voice: 'Aria' }];
    for (let i = 0; i < 30; i++) {
        const next = [{ speaker: `Anna${i}`, text: 'Hello' }, turns[1]];
        assignments = editedDialogueCast(previous, next, assignments, preferences, { index: 0 });
        expect(assignments).toEqual([{ speaker: `Anna${i}`, voice: 'George' }, { speaker: 'Ben', voice: 'Aria' }]);
        previous = next;
    }
    expect(JSON.stringify(preferences)).toBe(snapshot);
    const moved = shared.moveDialogueTurn(previous, 0, 1);
    expect(editedDialogueCast(previous, moved, assignments, preferences)).toEqual([assignments[1], assignments[0]]);
    const withNewFirst = [{ speaker: 'Saved0', text: 'New' }, ...moved];
    const added = editedDialogueCast(moved, withNewFirst, assignments, preferences);
    expect(added).toEqual([{ speaker: 'Saved0', voice: 'Sarah' }, assignments[1], assignments[0]]);
    expect(editedDialogueCast(withNewFirst, moved, added, preferences)).toEqual([assignments[1], assignments[0]]);
});
