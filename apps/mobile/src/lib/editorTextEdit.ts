import { TEXT_DEFAULTS } from '../../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { TEXT_EXTRAS } from '../../../../app/veyrnox/_lib/editorTextStyle.mjs';
import { updateSequenceClip } from '../../../../app/veyrnox/_lib/editorSequence.mjs';
import { insertTitlePreset } from '../../../../app/veyrnox/_lib/editorPresets.mjs';
import { applyAnimationCatalog, resetAnimationCatalog } from '../../../../app/veyrnox/_lib/editorAnimationCatalog.mjs';
import { clipAt, type Selection, type TextClip, type Timeline } from './nativeEditorModel';
export type TextStyleKey = 'color' | 'background' | 'backgroundOpacity' | 'stroke' | 'strokeWidth' | 'weight' | 'font' | 'align';
export type TypographyKey = 'italic' | 'underline' | 'letterSpacing' | 'lineHeight' | 'shadowColor' | 'shadowOpacity' | 'shadowBlur' | 'shadowX' | 'shadowY';
export type AnimationMode = 'in' | 'out' | 'loop';
export type AnimationOptions = { duration?: number; period?: number; amount?: number; restart?: boolean };
export type TextEditResult = { timeline: Timeline } | { refused: 'locked' | 'select' | 'invalid' };
type WebResult = Timeline | { error: string };
export const mergedTextStyle = (item: Pick<TextClip, 'style'>) => ({ ...TEXT_DEFAULTS, ...TEXT_EXTRAS, ...item.style });
function run(operation: () => WebResult): TextEditResult {
    try { const next = operation(); return 'error' in next ? { refused: 'invalid' } : { timeline: next }; }
    catch { return { refused: 'invalid' }; }
}
function selectedEdit(tl: Timeline, sel: Selection | null, textOnly: boolean, operation: (sel: Selection) => WebResult): TextEditResult {
    if (!sel || (sel.track !== 'text' && (textOnly || sel.track !== 'video'))) return { refused: 'select' };
    const item = clipAt(tl, sel);
    if (!item) return { refused: 'select' };
    if (tl.tracks.some(track => track.id === item.trackId && track.locked)) return { refused: 'locked' };
    return run(() => operation(sel));
}
export function textStyleEdit(tl: Timeline, sel: Selection | null, key: TextStyleKey, value: string | number): TextEditResult {
    return selectedEdit(tl, sel, true, selection => {
        const item = clipAt(tl, selection) as TextClip;
        return updateSequenceClip(tl, 'text', selection.id, { style: { ...TEXT_DEFAULTS, ...item.style, [key]: value } }) as WebResult;
    });
}
export function typographyEdit(tl: Timeline, sel: Selection | null, key: TypographyKey, value: string | number | boolean): TextEditResult {
    return selectedEdit(tl, sel, true, selection => {
        const item = clipAt(tl, selection) as TextClip;
        return updateSequenceClip(tl, 'text', selection.id, { style: { ...TEXT_EXTRAS, ...TEXT_DEFAULTS, ...item.style, [key]: value } }) as WebResult;
    });
}
export function titlePresetInsert(tl: Timeline, name: string, frame: number, sampleText: string): TextEditResult {
    if (!tl.tracks.some(track => track.kind === 'text' && !track.locked)) return { refused: 'locked' };
    return run(() => {
        const next = insertTitlePreset(tl, name, frame) as WebResult;
        return 'error' in next ? next : updateSequenceClip(next, 'text', `t${next.seq}`, { text: sampleText }) as WebResult;
    });
}
export const animationApply = (tl: Timeline, sel: Selection | null, mode: AnimationMode, id: string, opts: AnimationOptions): TextEditResult =>
    selectedEdit(tl, sel, false, selection => applyAnimationCatalog(tl, selection, mode, id, opts) as WebResult);
export const animationReset = (tl: Timeline, sel: Selection | null): TextEditResult =>
    selectedEdit(tl, sel, false, selection => resetAnimationCatalog(tl, selection) as WebResult);
