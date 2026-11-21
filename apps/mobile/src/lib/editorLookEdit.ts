import { updateSequenceClip, setSequenceTransition } from '../../../../app/veyrnox/_lib/editorSequence.mjs';
import { colourDefaults, colourProblem } from '../../../../app/veyrnox/_lib/editorColour.mjs';
import { FILTER_DEFAULTS, evaluatedParameters, parameterKeyframe } from '../../../../app/veyrnox/_lib/editorAnimation.mjs';
import { BACKGROUND_DEFAULTS, backgroundProblem } from '../../../../app/veyrnox/_lib/editorBackground.mjs';
import { helperDiagnostic } from '../../../../lib/helperMessages.mjs';
import type { Clip, Timeline } from './nativeEditorModel';
import type { CurvePoint } from './editorCurvePoints';
export type Colour = NonNullable<Clip['colourAdjustment']>;
export type ColourKey = 'exposure' | 'temperature' | 'tint' | 'shadows' | 'highlights' | 'gamma';
export type FilterKey = keyof typeof FILTER_DEFAULTS;
export type HslKey = 'hue' | 'saturation' | 'luminance';
export type Background = NonNullable<Clip['background']>;
export type Crop = NonNullable<Clip['crop']>;
export type LookRefusal = 'locked' | 'lockedAll' | 'notAdjacent' | 'tooLarge' | 'invalid';
export type LookResult = { timeline: Timeline } | { refused: LookRefusal };
export const lookRefusal = (error: unknown): LookRefusal =>
    typeof error === 'string' && helperDiagnostic(error)?.code === 'this_project_is_too_large_to_save_use' ? 'tooLarge' : 'invalid';
const round = (value: number) => Math.round(value * 1000) / 1000;
const selected = (tl: Timeline, id: string) => tl.video.find(c => c.id === id);
function refusal(tl: Timeline, id: string): LookRefusal | null {
    const clip = selected(tl, id);
    if (!clip) return 'invalid';
    return tl.tracks.some(t => t.id === clip.trackId && t.locked) ? 'locked' : null;
}
function result(run: () => Timeline | { error: unknown }): LookResult {
    try { const next = run(); return 'error' in next ? { refused: lookRefusal(next.error) } : { timeline: next }; }
    catch { return { refused: 'invalid' }; }
}
/** Offset is relative to the clip. Mirrors the web workspace's picture-key upsert, including outside-range writes. */
export function clipPatch(tl: Timeline, id: string, patch: Partial<Clip>, offset = 0, remove: readonly (keyof Clip)[] = []): LookResult {
    const bad = refusal(tl, id); if (bad) return { refused: bad };
    const clip = selected(tl, id)!;
    if (clip.parameterKeyframes?.length && (patch.filter || patch.colourAdjustment) && offset >= 0 && offset < clip.len) {
        const key = parameterKeyframe({ ...clip, ...patch, parameterKeyframes: [] }, offset);
        patch = { ...patch, parameterKeyframes: [...clip.parameterKeyframes.filter(k => k.frame !== offset), key].sort((a, b) => a.frame - b.frame) };
    }
    // Delete before validation, so reset can rescue a document near the byte limit. No undefined own properties.
    if (remove.length) {
        const clean = { ...clip }; patch = { ...patch };
        for (const key of remove) { delete clean[key]; delete patch[key]; }
        tl = { ...tl, video: tl.video.map(c => c.id === id ? clean : c) };
    }
    return result(() => updateSequenceClip(tl, 'video', id, patch) as Timeline | { error: unknown });
}
export function lookValues(clip: Clip, offset: number): { filter: Required<NonNullable<Clip['filter']>>; colour: Colour } {
    return evaluatedParameters(clip, offset);
}
function colourEdit(tl: Timeline, id: string, offset: number, change: (colour: Colour) => Colour): LookResult {
    const bad = refusal(tl, id); if (bad) return { refused: bad };
    const colour = change(lookValues(selected(tl, id)!, offset).colour);
    const problem = colourProblem(colour); if (problem) return { refused: lookRefusal(problem) };
    return clipPatch(tl, id, { colourAdjustment: colour }, offset);
}
export const colourSet = (tl: Timeline, id: string, key: ColourKey, value: number, offset = 0): LookResult =>
    colourEdit(tl, id, offset, c => ({ ...c, [key]: round(value) }));
export const hslSet = (tl: Timeline, id: string, channel: string, key: HslKey, value: number, offset = 0): LookResult =>
    colourEdit(tl, id, offset, c => ({ ...c, hsl: { ...c.hsl, [channel]: { ...c.hsl[channel], [key]: round(value) } } }));
export const curveSet = (tl: Timeline, id: string, channel: string, points: readonly CurvePoint[], offset = 0): LookResult =>
    colourEdit(tl, id, offset, c => ({ ...c, curves: { ...c.curves, [channel]: points.map(p => ({ ...p })) } }));
export function curveResetChannel(tl: Timeline, id: string, channel: string, offset = 0): LookResult {
    const points = colourDefaults().curves[channel];
    return points ? curveSet(tl, id, channel, points, offset) : { refused: 'invalid' };
}
export const colourReset = (tl: Timeline, id: string, offset = 0): LookResult =>
    clipPatch(tl, id, { colourAdjustment: colourDefaults() }, offset, ['colourAdjustment']);
export function filterSet(tl: Timeline, id: string, key: FilterKey, value: number, offset = 0): LookResult {
    const bad = refusal(tl, id); if (bad) return { refused: bad };
    return clipPatch(tl, id, { filter: { ...lookValues(selected(tl, id)!, offset).filter, [key]: round(value) } }, offset);
}
export const filterReset = (tl: Timeline, id: string, offset = 0): LookResult => clipPatch(tl, id, { filter: FILTER_DEFAULTS }, offset, ['filter']);
export const effectSet = (tl: Timeline, id: string, type: string, intensity: number): LookResult =>
    type === 'none' ? clipPatch(tl, id, {}, 0, ['effect']) : clipPatch(tl, id, { effect: { type, intensity: round(intensity) } });
export const effectIntensity = (tl: Timeline, id: string, intensity: number): LookResult =>
    effectSet(tl, id, selected(tl, id)?.effect?.type ?? 'none', intensity);
export const blendSet = (tl: Timeline, id: string, blend: string): LookResult => clipPatch(tl, id, { blend });
export function cropSet(tl: Timeline, id: string, crop: Crop): LookResult {
    const clamp = (v: number, lo: number, hi: number) => round(Math.max(lo, Math.min(hi, v)));
    const width = clamp(crop.width, .05, 1), height = clamp(crop.height, .05, 1);
    return clipPatch(tl, id, { crop: { x: clamp(crop.x, 0, 1 - width), y: clamp(crop.y, 0, 1 - height), width, height } });
}
export const cropReset = (tl: Timeline, id: string): LookResult => clipPatch(tl, id, {}, 0, ['crop']);
export function backgroundSet(tl: Timeline, id: string, patch: Partial<Background>): LookResult {
    const background = { ...BACKGROUND_DEFAULTS, ...selected(tl, id)?.background, ...patch } as Background;
    if (patch.type !== undefined) background.mediaId = patch.type === 'image'
        ? Object.values(tl.media).find(m => m.kind === 'image' || m.kind === 'graphic')?.id ?? '' : '';
    return clipPatch(tl, id, { background });
}
export function backgroundAll(tl: Timeline, background: Background): LookResult {
    if (tl.video.some(c => tl.tracks.some(t => t.id === c.trackId && t.locked))) return { refused: 'lockedAll' };
    const bad = backgroundProblem(background, tl.media); if (bad) return { refused: lookRefusal(bad) };
    let next = tl;
    for (const clip of tl.video) {
        const applied = clipPatch(next, clip.id, { background: { ...background } });
        if ('refused' in applied) return applied;
        next = applied.timeline;
    }
    return { timeline: next };
}
export const adjacent = (tl: Timeline, id: string): boolean => {
    const clip = selected(tl, id);
    return !!clip && tl.video.some(c => c.trackId === clip.trackId && c.start + c.len === clip.start);
};
export function transitionSet(tl: Timeline, id: string, type: string, frames?: number): LookResult {
    const bad = refusal(tl, id); if (bad) return { refused: bad };
    if (!adjacent(tl, id)) return { refused: 'notAdjacent' };
    const current = selected(tl, id)!.transition ?? 0;
    return result(() => setSequenceTransition(tl, id, type, frames ?? (current > 0 ? current : 15)) as Timeline | { error: unknown });
}
export const transitionLength = (tl: Timeline, id: string, frames: number): LookResult =>
    transitionSet(tl, id, selected(tl, id)?.transitionType ?? 'dissolve', frames);
export const transitionNone = (tl: Timeline, id: string): LookResult => clipPatch(tl, id, { transition: 0 });
