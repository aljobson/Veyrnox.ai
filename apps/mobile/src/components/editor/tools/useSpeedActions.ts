import { t } from '../../../lib/i18n';
import { clipAt, pruneEmptiedExtraTracks, removeSelections, type Clip, type Selection, type Timeline } from '../../../lib/nativeEditorModel';
import { freezeInsert, speedCurve, speedRate, speedReverse, type SpeedPoint, type SpeedResult } from '../../../lib/editorSpeedEdit';
import { trimItem } from '../../../lib/editorTimeline';
import type { FrameStore } from '../editorFrameStore';
export function useSpeedActions({ timeline, selection, applyTimeline, setProblem, setSelection, frameStore }: {
    timeline: Timeline; selection: Selection | null; applyTimeline(next: Timeline): boolean;
    setProblem(message: string | null): void; setSelection(next: Selection | null): void; frameStore: FrameStore;
}) {
    const refuse = (reason: 'outside' | 'locked' | 'invalid') => {
        setProblem(reason === 'outside' ? t('editorTools.outside') : reason === 'locked'
            ? t('editor.unlockoraddatrackfirst', { value1: selection?.track ?? 'video' }) : t('editorEditGate.invalid'));
        return false;
    };
    const commit = (result: SpeedResult) => {
        if ('refused' in result) return refuse(result.refused);
        if (!applyTimeline(result.timeline)) return false;
        setProblem(t('editorTools.updated')); return true;
    };
    return {
        changeSpeed: (rate: number) => {
            const clip = clipAt(timeline, selection) as Clip | undefined;
            if (!selection || !clip || (!clip.speedCurve?.length && rate === (clip.rate ?? 1))) return;
            commit(speedRate(timeline, selection, rate));
        },
        changeCurve: (points: readonly SpeedPoint[]) => { if (selection) commit(speedCurve(timeline, selection, points)); },
        toggleReverse: () => { if (selection) commit(speedReverse(timeline, selection)); },
        insertFreeze: () => {
            if (!selection) return;
            const result = freezeInsert(timeline, selection, frameStore.get());
            if (!commit(result) || !('timeline' in result)) return;
            const freeze = result.timeline.video.find(c => c.freezeFrame !== undefined && !timeline.video.some(old => old.id === c.id));
            if (freeze) setSelection({ track: 'video', id: freeze.id });
            setProblem(t('editorTools.freezeHelp'));
        },
        freezeLength: (length: number) => {
            const clip = clipAt(timeline, selection);
            if (!selection || !clip || clip.freezeFrame === undefined) return;
            if (timeline.tracks.some(track => track.id === clip.trackId && track.locked)) { refuse('locked'); return; }
            const next = trimItem(timeline, selection, 'out', length - clip.len, false, frameStore.get(), 'lane');
            if (next) commit({ timeline: next }); else refuse('invalid');
        },
        removeFreeze: () => {
            const clip = clipAt(timeline, selection);
            if (!selection || !clip || clip.freezeFrame === undefined) return;
            if (timeline.tracks.some(track => track.id === clip.trackId && track.locked)) { refuse('locked'); return; }
            const next = pruneEmptiedExtraTracks(removeSelections(timeline, [selection], 'lane'), [clip.trackId]);
            if (commit({ timeline: next })) setSelection(null);
        },
    };
}
export type SpeedActions = ReturnType<typeof useSpeedActions>;
