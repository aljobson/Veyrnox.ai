import { compileDialogueTurns, dialogueCastInputs, resolveDialogueCastAssignments, type CastAssignment, type DialogueTurn } from './dialogueShared';
import { normalizeDialogueTurns } from './dialogue';

const key = (speaker: string) => speaker.trim().toLowerCase();

// Reserve existing voices before assigning new names, regardless of turn order.
// Only current speakers are returned; partial names never build up in the cast.
export function editedDialogueCast(previous: readonly DialogueTurn[], next: readonly DialogueTurn[], assignments: readonly CastAssignment[],
    preferences: readonly CastAssignment[], rename?: { index: number; voice?: string }): CastAssignment[] {
    const speakers = resolveDialogueCastAssignments(next, []).map(item => item.speaker);
    const kept = assignments.flatMap(item => {
        const speaker = speakers.find(name => key(name) === key(item.speaker));
        return speaker ? [{ speaker, voice: item.voice }] : [];
    });
    if (rename) {
        const from = key(previous[rename.index].speaker), to = key(next[rename.index].speaker);
        const speaker = speakers.find(name => key(name) === to);
        const oldStillUsed = next.some((turn, index) => index !== rename.index && key(turn.speaker) === from);
        const alreadyExists = previous.some((turn, index) => index !== rename.index && key(turn.speaker) === to);
        const currentVoice = assignments.find(item => key(item.speaker) === from)?.voice;
        const voice = rename.voice ?? currentVoice;
        const carriedSplit = rename.voice !== undefined && rename.voice !== currentVoice;
        if (speaker && voice && (!oldStillUsed || carriedSplit) && !alreadyExists && !kept.some(item => key(item.speaker) === to || item.voice === voice)) {
            kept.push({ speaker, voice });
        }
    }
    const reserved = new Set(kept.map(item => key(item.speaker)));
    const resolved = resolveDialogueCastAssignments([
        ...kept.map(item => item.speaker), ...speakers.filter(speaker => !reserved.has(key(speaker))),
    ], [...kept, ...preferences]);
    return speakers.map(speaker => resolved.find(item => key(item.speaker) === key(speaker))!);
}

export function dialogueEditSignature(turns: readonly DialogueTurn[], cast: readonly CastAssignment[]) {
    const clean = normalizeDialogueTurns(turns);
    return JSON.stringify([compileDialogueTurns(clean), dialogueCastInputs(resolveDialogueCastAssignments(clean, cast))]);
}

// 'renamed' is a voice carried to a new name: shown, but never saved for that name.
export type VoiceOrigin = 'default' | 'saved' | 'explicit' | 'restored' | 'renamed';
export type EditingAssignment = CastAssignment & { origin: VoiceOrigin };
export type RenameCarry = { index: number; voice?: string };
export function assignmentOrigins(assignments: readonly CastAssignment[], previous: readonly EditingAssignment[], preferences: readonly CastAssignment[],
    renamedSpeaker?: string, carry?: RenameCarry): EditingAssignment[] {
    return assignments.map(item => {
        const known = previous.find(old => key(old.speaker) === key(item.speaker) && old.voice === item.voice);
        const inherited = renamedSpeaker !== undefined && key(item.speaker) === key(renamedSpeaker) && item.voice === carry?.voice;
        const saved = preferences.some(pref => key(pref.speaker) === key(item.speaker) && pref.voice === item.voice);
        return { ...item, origin: known?.origin ?? (saved ? 'saved' : inherited ? 'renamed' : 'default') };
    });
}
