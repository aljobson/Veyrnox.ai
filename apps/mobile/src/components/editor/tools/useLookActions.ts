import { FILTER_DEFAULTS } from '../../../../../../app/veyrnox/_lib/editorAnimation.mjs';
import { colourDefaults } from '../../../../../../app/veyrnox/_lib/editorColour.mjs';
import { documentIdentity } from '../../../lib/editorBridge';
import { t } from '../../../lib/i18n';
import * as edit from '../../../lib/editorLookEdit';
import type { Selection, Timeline } from '../../../lib/nativeEditorModel';
import type { FrameStore } from '../editorFrameStore';
export function useLookActions({ timeline, selection, applyTimeline, setProblem, frameStore }: {
    timeline: Timeline; selection: Selection | null; applyTimeline(next: Timeline): boolean;
    setProblem(message: string | null): void; frameStore: FrameStore;
}) {
    const id = selection?.track === 'video' ? selection.id : '';
    const offset = () => frameStore.get() - (timeline.video.find(c => c.id === id)?.start ?? 0);
    const commit = (result: edit.LookResult) => {
        if ('refused' in result) {
            const reason = result.refused;
            setProblem(reason === 'tooLarge' || reason === 'invalid' ? t(`editorEditGate.${reason}`) : t(`editorLook.${reason}`));
            return false;
        }
        if (documentIdentity(result.timeline) === documentIdentity(timeline)) return false;
        if (!applyTimeline(result.timeline)) return false;
        setProblem(null); return true;
    };
    return {
        frameStore,
        colour: (key: edit.ColourKey, value: number) => commit(edit.colourSet(timeline, id, key, value, offset())),
        hsl: (channel: string, key: edit.HslKey, value: number) => commit(edit.hslSet(timeline, id, channel, key, value, offset())),
        curve: (channel: string, points: Parameters<typeof edit.curveSet>[3]) => commit(edit.curveSet(timeline, id, channel, points, offset())),
        resetColour: () => { const c = timeline.video.find(c => c.id === id); return c && documentIdentity(edit.lookValues(c, offset()).colour) === documentIdentity(colourDefaults())
            ? false : commit(edit.colourReset(timeline, id, offset())); },
        filter: (key: edit.FilterKey, value: number) => commit(edit.filterSet(timeline, id, key, value, offset())),
        resetFilter: () => { const c = timeline.video.find(c => c.id === id); return c && documentIdentity(edit.lookValues(c, offset()).filter) === documentIdentity(FILTER_DEFAULTS)
            ? false : commit(edit.filterReset(timeline, id, offset())); },
        effect: (type: string) => commit(edit.effectSet(timeline, id, type, timeline.video.find(c => c.id === id)?.effect?.intensity ?? .5)),
        intensity: (value: number) => commit(edit.effectIntensity(timeline, id, value)),
        blend: (value: string) => commit(edit.blendSet(timeline, id, value)),
        crop: (value: edit.Crop) => commit(edit.cropSet(timeline, id, value)),
        resetCrop: () => commit(edit.cropReset(timeline, id)),
        background: (value: Partial<edit.Background>) => commit(edit.backgroundSet(timeline, id, value)),
        backgroundAll: (value: edit.Background) => commit(edit.backgroundAll(timeline, value)),
        transition: (type: string) => commit(edit.transitionSet(timeline, id, type)),
        transitionLength: (value: number) => commit(edit.transitionLength(timeline, id, value)),
        transitionNone: () => commit(edit.transitionNone(timeline, id)),
    };
}
export type LookActions = ReturnType<typeof useLookActions>;
