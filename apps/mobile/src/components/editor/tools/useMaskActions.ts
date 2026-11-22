import * as edit from '../../../lib/editorMotionEdit';
import { motionCommit, type MotionActionProps } from './useMotionActions';
import type { Selection } from '../../../lib/nativeEditorModel';
export function useMaskActions(props: MotionActionProps) {
    const { timeline: tl, selection: sel, frameStore } = props;
    const run = (fn: (s: Selection) => edit.MotionResult) => sel ? motionCommit(props, fn(sel)) : false;
    return {
        frameStore,
        shape: (value: string) => run(s => edit.maskShape(tl, s, value)),
        edit: (key: keyof edit.Mask, value: number | boolean) => run(s => edit.maskEdit(tl, s, frameStore.get(), key, value)),
        add: () => run(s => edit.maskKeyAdd(tl, s, frameStore.get())),
        easing: (index: number, value: string) => run(s => edit.maskKeyEasing(tl, s, index, value)),
        remove: (index: number) => run(s => edit.maskKeyRemove(tl, s, index)),
        reset: () => run(s => edit.maskReset(tl, s)),
        smart: (key: keyof edit.Smart, value: number | boolean | string) => run(s => edit.smartPictureEdit(tl, s, key, value)),
        resetSmart: () => run(s => edit.smartPictureReset(tl, s)),
    };
}
export type MaskActions = ReturnType<typeof useMaskActions>;
