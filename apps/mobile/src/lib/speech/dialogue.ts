import type { SubmitRequest } from '../generationSubmit';
import { estimateCredits, isSupported, kindOf, type CatalogModel } from '../media';
import { DIALOGUE_MODEL_ID, MAX_DIALOGUE_CHARS, MAX_DIALOGUE_TURNS, MIN_DIALOGUE_SPEAKERS,
    MAX_DIALOGUE_SPEAKERS, compileDialogueTurns, validateDialogueTurns, dialogueCastInputs,
    parseDialogue, dialogueVoiceOrder, resolveDialogueCastAssignments, type DialogueTurn, type CastAssignment } from './dialogueShared';

export const emptyDialogueTurns = (): DialogueTurn[] => [{ speaker: 'Ana', text: '' }, { speaker: 'Ben', text: '' }];
export const normalizeDialogueTurns = (turns: readonly DialogueTurn[]): DialogueTurn[] =>
    turns.map(turn => ({ speaker: turn.speaker.trim(), text: turn.text.replace(/\s+/gu, ' ').trim() }));
export const addDialogueTurn = (turns: readonly DialogueTurn[]): DialogueTurn[] => turns.length >= MAX_DIALOGUE_TURNS ? [...turns]
    : [...turns, { speaker: turns[Math.max(0, turns.length - 2)]?.speaker ?? 'Ana', text: '' }];
export const removeDialogueTurn = (turns: readonly DialogueTurn[], index: number): DialogueTurn[] =>
    turns.length <= 2 ? [...turns] : turns.filter((_, i) => i !== index);
export function dialogueModel(models: readonly CatalogModel[]): CatalogModel | null {
    return models.find(model => model.id === DIALOGUE_MODEL_ID && isSupported(model)
        && kindOf(model.modality) === 'audio' && Number.isFinite(model.credits) && model.credits >= 0) ?? null;
}
export function validateDialogue(turns: readonly DialogueTurn[], assignments: readonly CastAssignment[]): string | null {
    const clean = normalizeDialogueTurns(turns), checked = validateDialogueTurns(clean);
    if (!checked.ok) {
        if (clean.length < 2 || clean.length > MAX_DIALOGUE_TURNS) return 'dialogue.turnLimit';
        if (clean.some(turn => !turn.text)) return 'dialogue.wordsRequired';
        if (checked.speakers.length < MIN_DIALOGUE_SPEAKERS || checked.speakers.length > MAX_DIALOGUE_SPEAKERS) return 'dialogue.speakerLimit';
        if (checked.characters > MAX_DIALOGUE_CHARS) return 'dialogue.tooLong';
        return 'dialogue.invalid';
    }
    const inputs = dialogueCastInputs(assignments);
    const parsed = parseDialogue(checked.script, dialogueVoiceOrder(inputs));
    if (assignments.length !== checked.speakers.length || Object.keys(inputs).length !== assignments.length
        || new Set(assignments.map(item => item.speaker.toLowerCase())).size !== assignments.length
        || !parsed.ok || parsed.blocks.length !== clean.length
        || parsed.blocks.some((block, index) => block.text !== clean[index].text
            || block.voice !== assignments.find(item => item.speaker.toLowerCase() === clean[index].speaker.toLowerCase())?.voice)) return 'dialogue.castInvalid';
    return null;
}
export function buildDialogueRequest(turns: readonly DialogueTurn[], assignments: readonly CastAssignment[], model: CatalogModel): SubmitRequest {
    const error = validateDialogue(turns, assignments);
    if (error) throw new Error(error);
    return { modelId: model.id, prompt: compileDialogueTurns(normalizeDialogueTurns(turns)), extraInputs: dialogueCastInputs(assignments),
        durationSeconds: null, confirmedCredits: estimateCredits(model, null), analyticsKind: 'audio' };
}

// Names are absent from gateway blocks. Recover them with its SPEAKER_LINE rule,
// then require a lossless round trip through both shared validators before restoring.
export function restoreDialogue(request: SubmitRequest): { turns: DialogueTurn[]; assignments: CastAssignment[] } | null {
    if (request?.modelId !== DIALOGUE_MODEL_ID || typeof request.prompt !== 'string') return null;
    const turns: DialogueTurn[] = [];
    for (const line of request.prompt.split(/\r?\n/)) {
        const match = /^\s*([\p{L}][\p{L}\p{N} .'-]{0,29}):\s*(.+)$/u.exec(line);
        if (!match) return null;
        turns.push({ speaker: match[1].trim(), text: match[2].trim() });
    }
    const order = dialogueVoiceOrder(request.extraInputs);
    if (!order || compileDialogueTurns(normalizeDialogueTurns(turns)) !== request.prompt) return null;
    const assignments = resolveDialogueCastAssignments(turns, []).map((item, index) => ({ ...item, voice: order[index] }));
    const inputs = dialogueCastInputs(assignments);
    if (!request.extraInputs || typeof request.extraInputs !== 'object' || Array.isArray(request.extraInputs)
        || Object.keys(request.extraInputs).length !== Object.keys(inputs).length
        || Object.entries(inputs).some(([key, voice]) => request.extraInputs?.[key] !== voice)) return null;
    if (validateDialogue(turns, assignments)) return null;
    const original = parseDialogue(request.prompt, order), rebuilt = parseDialogue(request.prompt, dialogueVoiceOrder(dialogueCastInputs(assignments)));
    if (!original.ok || !rebuilt.ok || JSON.stringify(original.blocks) !== JSON.stringify(rebuilt.blocks)) return null;
    return { turns, assignments };
}
