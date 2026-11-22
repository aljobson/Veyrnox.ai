import * as edit from '../../../lib/editorMotionEdit';
import { documentIdentity } from '../../../lib/editorBridge';
import { clipAt, framesIn, type Selection, type Timeline } from '../../../lib/nativeEditorModel';
import { t } from '../../../lib/i18n';
import type { FrameStore } from '../editorFrameStore';
export type MotionActionProps = {
    timeline: Timeline; selection: Selection | null; applyTimeline(next: Timeline): boolean;
    setProblem(message: string | null): void; frameStore: FrameStore;
};
export function motionCommit(props: MotionActionProps, result: edit.MotionResult): boolean {
    if ('refused' in result) {
        const reason = result.refused;
        props.setProblem(reason === 'invalid' || reason === 'tooLarge' ? t(`editorEditGate.${reason}`) : reason === 'locked' ? t('editorMotion.locked')
            : reason === 'outside' ? t('editorMotion.outside') : t('editorMotion.full'));
        return false;
    }
    if (documentIdentity(result.timeline) === documentIdentity(props.timeline)) return false;
    if (!props.applyTimeline(result.timeline)) return false;
    props.setProblem(null); return true;
}
export function useMotionActions(props: MotionActionProps & { setFrame(frame: number): void; setPlaying(playing: boolean): void }) {
    const { timeline: tl, selection: sel, frameStore } = props;
    const run = (fn: (sel: Selection) => edit.MotionResult) => sel ? motionCommit(props, fn(sel)) : false;
    return {
        frameStore,
        transform: (key: keyof edit.Transform, value: number | boolean) => run(s => edit.transformEdit(tl, s, frameStore.get(), key, value)),
        position: (x: number, y: number, frame = frameStore.get()) => run(s => {
            const clip = clipAt(tl, s)!;
            return edit.clipPatch(tl, s, frame, { transform: { ...edit.evaluatedAt(clip, frame).transform, x, y } });
        }),
        preset: (name: string) => run(s => edit.motionPresetApply(tl, s, name)),
        add: () => run(s => edit.motionKeyAdd(tl, s, frameStore.get())),
        point: (index: number, key: string, value: number | string) => run(s => edit.motionKeyEdit(tl, s, index, key, value)),
        moveToPlayhead: (index: number) => run(s => edit.motionKeyEdit(tl, s, index, 'frame', frameStore.get() - clipAt(tl, s)!.start)),
        remove: (index: number) => run(s => edit.motionKeyRemove(tl, s, index)),
        clear: () => run(s => edit.motionKeysClear(tl, s)),
        go: (index: number) => {
            const clip = clipAt(tl, sel), key = clip?.keyframes?.[index];
            if (!clip || !key || key.frame < 0 || key.frame >= clip.len) return;
            props.setPlaying(false); props.setFrame(Math.max(0, Math.min(framesIn(tl) - 1, clip.start + key.frame)));
        },
        addPicture: () => run(s => edit.parameterKeyAdd(tl, s, frameStore.get())),
        pictureEasing: (index: number, value: string) => run(s => edit.parameterKeyEasing(tl, s, index, value)),
        removePicture: (index: number) => run(s => edit.parameterKeyRemove(tl, s, index)),
        clearPicture: () => run(s => edit.parameterKeysClear(tl, s)),
    };
}
export type MotionActions = ReturnType<typeof useMotionActions>;
