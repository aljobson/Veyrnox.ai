import { useEffect, useRef, useState } from 'react';
import { subscribeCacheUser } from '../../lib/appCache';
import { captureHandoffOwner } from '../../lib/accountHandoffStore';
import { emptyDialogueTurns, restoreDialogue } from '../../lib/speech/dialogue';
import { assignmentOrigins, dialogueEditSignature, editedDialogueCast, type EditingAssignment, type RenameCarry } from '../../lib/speech/dialogueEditing';
import { normalizeDialogueCastMap, resolveDialogueCastAssignments, type CastAssignment, type DialogueTurn } from '../../lib/speech/dialogueShared';
import { loadDialogueCast, saveDialogueCast, forgetDialogueCastSpeakers } from '../../lib/speech/dialogueCastStore';
import { useStudioReopen } from '../speech/useStudioReopen';

const key = (name: string) => name.trim().toLowerCase();
const fresh = () => {
    const turns = emptyDialogueTurns();
    return { turns, cast: assignmentOrigins(resolveDialogueCastAssignments(turns, []), [], []), edited: false, turnEdited: false, perJob: false };
};

export function useDialogueEditor({ reopen, blocked, editAttempt, resetAttempt, markReopened }: {
    reopen?: string | string[]; blocked: () => boolean;
    editAttempt: (changed: boolean) => void; resetAttempt: () => void; markReopened: (jobId: string) => void;
}) {
    const [state, setState] = useState(fresh);
    const [ownerVersion, setOwnerVersion] = useState(0);
    const preferences = useRef<CastAssignment[]>([]);
    // Overlay choices and forgets made while the account read is still in flight.
    const preferenceEdits = useRef(new Map<string, CastAssignment | null>());
    const carries = useRef(new Map<number, RenameCarry>());
    const [preferenceVersion, setPreferenceVersion] = useState(0);
    const restored = useStudioReopen(reopen, request => {
        const saved = restoreDialogue(request);
        if (!saved) return false;
        setState({ turns: saved.turns, cast: saved.assignments.map(item => ({ ...item, origin: 'restored' })), edited: false, turnEdited: false, perJob: true });
        return true;
    }, () => { resetAttempt(); carries.current.clear(); setState(fresh()); }, markReopened);

    function resetOwner() {
        preferences.current = []; preferenceEdits.current.clear(); carries.current.clear(); setState(fresh());
        setOwnerVersion(value => value + 1);
    }
    useEffect(() => subscribeCacheUser(resetOwner), []);
    useEffect(() => {
        let live = true;
        const current = captureHandoffOwner();
        void loadDialogueCast().then(saved => {
            if (!live || !current()) return;
            const edits = preferenceEdits.current;
            preferences.current = normalizeDialogueCastMap([
                ...[...edits.values()].filter((item): item is CastAssignment => item !== null),
                ...saved.filter(item => !edits.has(key(item.speaker))),
            ]);
            setPreferenceVersion(value => value + 1);
        });
        return () => { live = false; };
    }, [ownerVersion]);

    useEffect(() => {
        if (restored.loading || state.edited || state.perJob) return;
        const cast = assignmentOrigins(resolveDialogueCastAssignments(state.turns, preferences.current), [], preferences.current);
        if (JSON.stringify(cast) !== JSON.stringify(state.cast)) {
            // Account data may fill an untouched fresh/failed-restore form, never a per-job cast.
            setState(previous => ({ ...previous, cast }));
        }
    }, [preferenceVersion, restored.loading, state]);

    function apply(turns: DialogueTurn[], cast: EditingAssignment[], turnEdit: boolean) {
        editAttempt(dialogueEditSignature(state.turns, state.cast) !== dialogueEditSignature(turns, cast));
        restored.dismiss();
        setState({ ...state, turns, cast, edited: true, turnEdited: state.turnEdited || turnEdit });
    }
    function editTurns(next: DialogueTurn[], renamedIndex?: number, structural = true) {
        if (blocked() || restored.loading) return;
        if (structural) carries.current.clear();
        let carry: RenameCarry | undefined;
        if (renamedIndex !== undefined) {
            carry = carries.current.get(renamedIndex);
            if (!carry) {
                const original = state.cast.find(item => key(item.speaker) === key(state.turns[renamedIndex].speaker));
                carry = { index: renamedIndex, voice: original?.voice };
                carries.current.set(renamedIndex, carry);
            }
        }
        const assignments = editedDialogueCast(state.turns, next, state.cast, preferences.current, carry);
        const cast = assignmentOrigins(assignments, state.cast, preferences.current, renamedIndex === undefined ? undefined : next[renamedIndex].speaker, carry);
        apply(next, cast, true);
    }
    function editTurn(index: number, turn: DialogueTurn) {
        editTurns(state.turns.map((item, i) => i === index ? turn : item), turn.speaker !== state.turns[index].speaker ? index : undefined, false);
    }
    function chooseVoice(speaker: string, voice: string) {
        if (blocked() || restored.loading) return;
        const selected = state.cast.find(item => item.speaker === speaker);
        if (!selected || selected.voice === voice) return;
        carries.current.clear();
        const persist: CastAssignment[] = [];
        const cast = state.cast.map(item => {
            if (item.speaker !== speaker && item.voice !== voice) return item;
            const next = { speaker: item.speaker, voice: item.speaker === speaker ? voice : selected.voice };
            const keep = item.speaker === speaker || item.origin === 'saved' || item.origin === 'explicit';
            if (keep) persist.push(next);
            return { ...next, origin: keep ? 'explicit' as const : item.origin };
        });
        for (const item of persist) preferenceEdits.current.set(key(item.speaker), item);
        preferences.current = normalizeDialogueCastMap([...persist, ...preferences.current]);
        apply(state.turns, cast, false); void saveDialogueCast(persist);
    }
    function resetCast() {
        if (blocked() || restored.loading) return;
        carries.current.clear();
        const speakers = state.cast.map(item => item.speaker), names = new Set(speakers.map(key));
        for (const name of names) preferenceEdits.current.set(name, null);
        preferences.current = preferences.current.filter(item => !names.has(key(item.speaker)));
        const cast = assignmentOrigins(resolveDialogueCastAssignments(state.turns, []), [], []);
        apply(state.turns, cast, false); void forgetDialogueCastSpeakers(speakers);
    }
    return { turns: state.turns, assignments: state.cast, turnEdited: state.turnEdited, restored, editTurns, editTurn, chooseVoice, resetCast };
}
