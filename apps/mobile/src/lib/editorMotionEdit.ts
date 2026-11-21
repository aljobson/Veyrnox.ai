import { TRANSFORM_DEFAULTS, EASINGS, PARAMETER_BOUNDS, evaluatedTransform, evaluatedParameters,
    parameterKeyframe, motionPreset } from '../../../../app/veyrnox/_lib/editorAnimation.mjs';
import { MASK_DEFAULTS, maskDefaults, evaluatedMask, maskKeyframe } from '../../../../app/veyrnox/_lib/editorMask.mjs';
import { SMART_PICTURE } from '../../../../app/veyrnox/_lib/editorSmartPicture.mjs';
import { updateSequenceClip } from '../../../../app/veyrnox/_lib/editorSequence.mjs';
import { clipPatch as lookPatch, lookRefusal } from './editorLookEdit';
import { documentIdentity } from './editorBridge';
import { clipAt, type Clip, type TextClip, type Selection, type Timeline } from './nativeEditorModel';
export { TRANSFORM_DEFAULTS, EASINGS, PARAMETER_BOUNDS, MASK_DEFAULTS, SMART_PICTURE };
export type Transform = Required<NonNullable<Clip['transform']>>;
export type Mask = NonNullable<Clip['maskSettings']>;
export type Smart = NonNullable<Clip['smartPicture']>;
export type MotionResult = { timeline: Timeline } | { refused: 'locked' | 'outside' | 'full' | 'invalid' | 'tooLarge' };
type KeyArray = 'keyframes' | 'parameterKeyframes' | 'maskKeyframes';
type Key = { frame: number; [name: string]: unknown };
export function evaluatedAt(clip: Clip | TextClip, frame: number): { transform: Transform; mask: Mask;
    parameters: { filter: Required<NonNullable<Clip['filter']>>; colour: NonNullable<Clip['colourAdjustment']> } } {
    const offset = frame - clip.start;
    return { transform: evaluatedTransform(clip, offset, false), mask: evaluatedMask(clip, offset), parameters: evaluatedParameters(clip, offset) };
}
function refusal(tl: Timeline, sel: Selection | null): MotionResult | null {
    const clip = clipAt(tl, sel);
    if (!sel || sel.track === 'audio' || !clip) return { refused: 'invalid' };
    return tl.tracks.some(t => t.id === clip.trackId && t.locked) ? { refused: 'locked' } : null;
}
const equal = (a: unknown, b: unknown) => documentIdentity(a) === documentIdentity(b);
/** Motion upsert from the workspace; picture seeding stays in S6's shared patch. */
export function clipPatch(tl: Timeline, sel: Selection, frame: number, next: Partial<Clip & TextClip>): MotionResult {
    const bad = refusal(tl, sel); if (bad) return bad;
    const clip = clipAt(tl, sel)!, at = frame - clip.start;
    const evaluated = evaluatedAt(clip, frame);
    if (Object.entries(next).every(([key, value]) => equal(key === 'transform' ? evaluatedAt(clip, Math.max(clip.start, frame)).transform
        : key === 'filter' ? evaluated.parameters.filter : key === 'colourAdjustment' ? evaluated.parameters.colour
        : (clip as Record<string, unknown>)[key], value))) return { timeline: tl };
    if (next.transform && clip.keyframes?.length && at >= 0 && at < clip.len) {
        if (clip.keyframes.length >= 40 && !clip.keyframes.some(k => k.frame === at)) return { refused: 'full' };
        const { x, y, scale, rotation, opacity } = next.transform;
        const key = { frame: at, x, y, scale, rotation, opacity, easing: 'linear' };
        next = { ...next, keyframes: [...clip.keyframes.filter(k => k.frame !== at), key].sort((a, b) => a.frame - b.frame) };
    }
    try {
        if (sel.track === 'video') {
            const result = lookPatch(tl, sel.id, next, at);
            return 'timeline' in result ? result : { refused: result.refused === 'tooLarge' ? 'tooLarge' : result.refused === 'locked' ? 'locked' : 'invalid' };
        }
        const result = updateSequenceClip(tl, sel.track, sel.id, next) as Timeline | { error: unknown };
        return 'error' in result ? { refused: lookRefusal(result.error) === 'tooLarge' ? 'tooLarge' : 'invalid' } : { timeline: result };
    } catch { return { refused: 'invalid' }; }
}
export function transformEdit(tl: Timeline, sel: Selection, frame: number, key: keyof Transform, value: number | boolean): MotionResult {
    const bad = refusal(tl, sel); if (bad) return bad;
    if (sel.track !== 'video') return { refused: 'invalid' };
    const clip = clipAt(tl, sel)!;
    const transform = evaluatedAt(clip, Math.max(clip.start, frame)).transform;
    return transform[key] === value ? { timeline: tl } : clipPatch(tl, sel, frame, { transform: { ...transform, [key]: value } });
}
export function motionPresetApply(tl: Timeline, sel: Selection, name: string): MotionResult {
    const bad = refusal(tl, sel); if (bad) return bad;
    if (!['pan-right', 'rise', 'arc', 'push-in'].includes(name)) return { refused: 'invalid' };
    return clipPatch(tl, sel, 0, { keyframes: motionPreset(clipAt(tl, sel), name) });
}
function add(tl: Timeline, sel: Selection, frame: number, field: KeyArray): MotionResult {
    const bad = refusal(tl, sel); if (bad) return bad;
    if (sel.track !== 'video' && field !== 'keyframes') return { refused: 'invalid' };
    const clip = clipAt(tl, sel)!, at = frame - clip.start, keys = clip[field] ?? [];
    if (at < 0 || at >= clip.len) return { refused: 'outside' };
    if (keys.length >= 40 && (field !== 'maskKeyframes' || !keys.some(k => k.frame === at))) return { refused: 'full' };
    if (field === 'maskKeyframes' && (!(clip as Clip).mask || (clip as Clip).mask === 'none')) return { refused: 'invalid' };
    const { x, y, scale, rotation, opacity } = evaluatedAt(clip, frame).transform;
    const key = field === 'keyframes' ? { frame: at, x, y, scale, rotation, opacity, easing: 'linear' }
        : field === 'parameterKeyframes' ? parameterKeyframe(clip, at) : maskKeyframe(clip, at);
    return clipPatch(tl, sel, frame, { [field]: [...keys.filter(k => k.frame !== at), key].sort((a, b) => a.frame - b.frame) });
}
function change(tl: Timeline, sel: Selection, field: KeyArray, index: number | null, patch?: Partial<Key>): MotionResult {
    const bad = refusal(tl, sel); if (bad) return bad;
    if (sel.track !== 'video' && field !== 'keyframes') return { refused: 'invalid' };
    const keys = clipAt(tl, sel)![field] ?? [];
    if (index === null && !keys.length) return { timeline: tl };
    if (index !== null && (!Number.isInteger(index) || !keys[index])) return { refused: 'invalid' };
    const next = index === null ? [] : patch ? keys.map((k, i) => i === index ? { ...k, ...patch } : k).sort((a, b) => a.frame - b.frame)
        : keys.filter((_, i) => i !== index);
    return clipPatch(tl, sel, 0, { [field]: next });
}
export const motionKeyAdd = (tl: Timeline, sel: Selection, frame: number) => add(tl, sel, frame, 'keyframes');
export const motionKeyEdit = (tl: Timeline, sel: Selection, index: number, key: string, value: number | string) => change(tl, sel, 'keyframes', index, { [key]: value });
export const motionKeyRemove = (tl: Timeline, sel: Selection, index: number) => change(tl, sel, 'keyframes', index);
export const motionKeysClear = (tl: Timeline, sel: Selection) => change(tl, sel, 'keyframes', null);
export const parameterKeyAdd = (tl: Timeline, sel: Selection, frame: number) => add(tl, sel, frame, 'parameterKeyframes');
export const parameterKeyEasing = (tl: Timeline, sel: Selection, index: number, easing: string) => change(tl, sel, 'parameterKeyframes', index, { easing });
export const parameterKeyRemove = (tl: Timeline, sel: Selection, index: number) => change(tl, sel, 'parameterKeyframes', index);
export const parameterKeysClear = (tl: Timeline, sel: Selection) => change(tl, sel, 'parameterKeyframes', null);
export function maskShape(tl: Timeline, sel: Selection, shape: string): MotionResult {
    const c = clipAt(tl, sel) as Clip | undefined;
    const bad = refusal(tl, sel); if (bad) return bad;
    if (sel.track !== 'video') return { refused: 'invalid' };
    return (c?.mask ?? 'none') === shape ? { timeline: tl }
        : clipPatch(tl, sel, 0, { mask: shape, maskSettings: maskDefaults(shape), maskKeyframes: [] });
}
export function maskEdit(tl: Timeline, sel: Selection, frame: number, key: keyof Mask, value: number | boolean): MotionResult {
    const bad = refusal(tl, sel); if (bad) return bad;
    if (sel.track !== 'video') return { refused: 'invalid' };
    const clip = clipAt(tl, sel)!, at = frame - clip.start, current = evaluatedAt(clip, frame).mask;
    if (current[key] === value) return { timeline: tl };
    const maskSettings = { ...current, [key]: value };
    const keys = clip.maskKeyframes;
    if (keys && keys.length >= 40 && at >= 0 && at < clip.len && key !== 'inverted' && !keys.some(k => k.frame === at)) return { refused: 'full' };
    return clipPatch(tl, sel, frame, { maskSettings, ...(keys?.length && at >= 0 && at < clip.len && key !== 'inverted'
        ? { maskKeyframes: [...keys.filter(k => k.frame !== at), maskKeyframe({ ...clip, maskSettings, maskKeyframes: [] }, at)].sort((a, b) => a.frame - b.frame) } : {}) });
}
export const maskKeyAdd = (tl: Timeline, sel: Selection, frame: number) => add(tl, sel, frame, 'maskKeyframes');
export const maskKeyEasing = (tl: Timeline, sel: Selection, index: number, easing: string) => change(tl, sel, 'maskKeyframes', index, { easing });
export const maskKeyRemove = (tl: Timeline, sel: Selection, index: number) => change(tl, sel, 'maskKeyframes', index);
export function maskReset(tl: Timeline, sel: Selection): MotionResult {
    const clip = clipAt(tl, sel) as Clip | undefined;
    const bad = refusal(tl, sel); if (bad) return bad;
    if (sel.track !== 'video') return { refused: 'invalid' };
    const settings = maskDefaults(clip?.mask);
    return equal(clip?.maskSettings ?? settings, settings) && !clip?.maskKeyframes?.length ? { timeline: tl }
        : clipPatch(tl, sel, 0, { maskSettings: settings, maskKeyframes: [] });
}
export function smartPictureEdit(tl: Timeline, sel: Selection, key: keyof Smart, value: number | boolean | string): MotionResult {
    const bad = refusal(tl, sel); if (bad) return bad;
    if (sel.track !== 'video') return { refused: 'invalid' };
    const current = { ...SMART_PICTURE, ...(clipAt(tl, sel) as Clip).smartPicture };
    return current[key] === value ? { timeline: tl } : clipPatch(tl, sel, 0, { smartPicture: { ...current, [key]: value } });
}
export function smartPictureReset(tl: Timeline, sel: Selection): MotionResult {
    const bad = refusal(tl, sel); if (bad) return bad;
    if (sel.track !== 'video') return { refused: 'invalid' };
    return equal({ ...SMART_PICTURE, ...(clipAt(tl, sel) as Clip).smartPicture }, SMART_PICTURE) ? { timeline: tl }
        : clipPatch(tl, sel, 0, { smartPicture: { ...SMART_PICTURE } });
}
