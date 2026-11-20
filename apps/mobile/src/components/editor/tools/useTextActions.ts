import { t } from '../../../lib/i18n';
import { animationApply, animationReset, textStyleEdit, typographyEdit, titlePresetInsert,
    type AnimationMode, type AnimationOptions, type TextEditResult, type TextStyleKey, type TypographyKey } from '../../../lib/editorTextEdit';
import type { Selection, Timeline } from '../../../lib/nativeEditorModel';
import type { FrameStore } from '../editorFrameStore';
import type { Tool } from './editorTools';
export function useTextActions({ timeline, selection, applyTimeline, setProblem, setSelection, setSelections, setTool, frameStore }: {
    timeline: Timeline; selection: Selection | null; applyTimeline(next: Timeline): boolean; setProblem(message: string | null): void;
    setSelection(next: Selection | null): void; setSelections(next: Selection[]): void; setTool(tool: Tool): void; frameStore: FrameStore;
}) {
    const commit = (result: TextEditResult, track = selection?.track ?? 'text', textOnly = false) => {
        if ('refused' in result) {
            setProblem(result.refused === 'locked' ? t('editor.unlockoraddatrackfirst', { value1: track })
                : result.refused === 'select' ? (textOnly ? t('editor.selectatextlayeronthetimeline') : t('editorText.visualSelection')) : t('editorEditGate.invalid'));
            return false;
        }
        if (!applyTimeline(result.timeline)) return false;
        setProblem(null); return true;
    };
    return {
        style: (key: TextStyleKey, value: string | number) => commit(textStyleEdit(timeline, selection, key, value), selection?.track, true),
        typography: (key: TypographyKey, value: string | number | boolean) => commit(typographyEdit(timeline, selection, key, value), selection?.track, true),
        insertPreset: (name: string) => {
            const sample = name === 'Lower third' ? t('editorText.lowerThirdSample') : t('editor.yourtitle');
            const result = titlePresetInsert(timeline, name, frameStore.get(), sample);
            if (!commit(result, 'text') || !('timeline' in result)) return;
            const next: Selection = { track: 'text', id: `t${result.timeline.seq}` };
            setSelection(next); setSelections([next]); setTool('text');
        },
        applyAnimation: (mode: AnimationMode, id: string, opts: AnimationOptions) => commit(animationApply(timeline, selection, mode, id, opts)),
        resetAnimation: () => commit(animationReset(timeline, selection)),
    };
}
export type TextActions = ReturnType<typeof useTextActions>;
