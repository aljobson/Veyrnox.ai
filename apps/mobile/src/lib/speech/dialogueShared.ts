// Typed seam: the web studio and gateway remain the authorities for dialogue.
// @ts-ignore shared plain JavaScript
import * as studio from '../../../../../app/veyrnox/_lib/dialogueStudio.js';
// @ts-ignore shared pure functions; never call the browser storage helpers
import * as cast from '../../../../../app/veyrnox/_lib/dialogueCastMap.js';
// @ts-ignore shared plain JavaScript
import * as server from '../../../../../lib/dialogue.js';

export interface DialogueTurn { speaker: string; text: string }
export interface CastAssignment { speaker: string; voice: string }
export type CastInputs = Record<string, string>;
export const { DIALOGUE_MODEL_ID, DIALOGUE_VOICES, MAX_DIALOGUE_CHARS, MAX_DIALOGUE_TURNS,
    MIN_DIALOGUE_SPEAKERS, MAX_DIALOGUE_SPEAKERS, compileDialogueTurns, validateDialogueTurns,
    moveDialogueTurn, estimatedDialogueSeconds } = studio as unknown as {
    DIALOGUE_MODEL_ID: string; DIALOGUE_VOICES: readonly string[]; MAX_DIALOGUE_CHARS: number;
    MAX_DIALOGUE_TURNS: number; MIN_DIALOGUE_SPEAKERS: number; MAX_DIALOGUE_SPEAKERS: number;
    compileDialogueTurns: (turns: readonly DialogueTurn[]) => string;
    validateDialogueTurns: (turns: readonly DialogueTurn[]) => {
        ok: boolean; errors: string[]; script: string; characters: number; speakers: CastAssignment[];
    };
    moveDialogueTurn: (turns: readonly DialogueTurn[], index: number, direction: -1 | 1) => DialogueTurn[];
    estimatedDialogueSeconds: (turns: readonly DialogueTurn[]) => number;
};
export const { normalizeDialogueCastMap, resolveDialogueCastAssignments, dialogueCastInputs } = cast as unknown as {
    normalizeDialogueCastMap: (value: unknown) => CastAssignment[];
    resolveDialogueCastAssignments: (speakers: readonly (string | DialogueTurn)[], cast: unknown) => CastAssignment[];
    dialogueCastInputs: (assignments: readonly CastAssignment[]) => CastInputs;
};
export const { parseDialogue, dialogueVoiceOrder } = server as unknown as {
    parseDialogue: (script: string, voices?: readonly string[] | null) => { ok: true; blocks: { voice: string; text: string }[] } | { ok: false };
    dialogueVoiceOrder: (inputs: unknown) => string[] | null;
};
