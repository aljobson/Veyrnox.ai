import type { Timeline, Clip, TextClip, TrackKind } from './nativeEditorModel';
// The document boundary stays shared with the web (including extensions and byte limits).
import { validateSequence as validateWebSequence } from '../../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
export const validateAgentTimeline: (timeline: unknown) => string | null = validateWebSequence;
export type Command = { op: string; kind?: TrackKind; id?: string; frame?: number; edge?: string; frames?: number; start?: number; ripple?: boolean; volume?: number; rate?: number; text?: string; len?: number; mediaId?: string };
type Key = { frame: number; [key: string]: unknown };
type Item = (Clip | TextClip) & {
    mediaId?: string; in?: number; volume?: number; transition?: number; rate?: number; reverse?: boolean; freezeFrame?: number;
    fadeIn?: number; fadeOut?: number; speedCurve?: { frame: number; rate: number }[]; words?: { start: number; [key: string]: unknown }[];
    keyframes?: Key[]; parameterKeyframes?: Key[]; maskKeyframes?: Key[];
    animation?: { offset?: number; span?: number; [key: string]: unknown };
};
const MAX = 18000;
const fail = () => ({ error: 'invalid_operation' as const });
const checked = (timeline: Timeline): Timeline | { error: string } => validateAgentTimeline(timeline) ? fail() : timeline;
const laneEnd = (tl: Timeline, trackId: string) => Math.max(0, ...[...tl.video, ...tl.audio, ...tl.text].filter(c => c.trackId === trackId).map(c => c.start + c.len));
// Ported from editorSpeed.mjs: retain the integral, including reverse/ramp source frames.
function advance(c: Item, frame: number): number {
    const keys = c.speedCurve || [];
    if (!keys.length) return frame * (c.rate ?? 1);
    const primitive = (at: number) => {
        let sum = (Math.min(at, keys[0].frame) - keys[0].frame) * keys[0].rate;
        if (at <= keys[0].frame) return sum;
        for (let i = 1; i < keys.length; i++) {
            const a = keys[i - 1], b = keys[i], d = Math.min(at, b.frame) - a.frame;
            sum += a.rate * d + (b.rate - a.rate) * d * d / (2 * (b.frame - a.frame));
            if (at <= b.frame) return sum;
        }
        const last = keys[keys.length - 1];
        return sum + (at - last.frame) * last.rate;
    };
    return primitive(frame) - primitive(0);
}
const sourceFrame = (c: Item, offset: number) => c.freezeFrame ?? c.in! + (c.reverse ? -1 : 1) * advance(c, offset);
const shift = <T extends { frame: number }>(keys: T[], from: number): T[] => keys.map(key => ({ ...key, frame: key.frame - from }));
const animation = (c: Item, from: number) => ({
    ...(c.keyframes ? { keyframes: shift(c.keyframes, from) } : {}),
    ...(c.parameterKeyframes ? { parameterKeyframes: shift(c.parameterKeyframes, from) } : {}),
    ...(c.animation ? { animation: { ...c.animation, offset: (c.animation.offset || 0) + from, span: c.animation.span || c.len } } : {}),
});
const words = (c: Item, from: number) => c.words ? { words: c.words.map(w => ({ ...w, start: w.start - from })) } : {};
const fades = (c: Item, kind: TrackKind, len: number) => kind !== 'text' ? { fadeIn: Math.min(c.fadeIn || 0, len), fadeOut: Math.min(c.fadeOut || 0, len) } : {};
const masks = (c: Item, from: number) => c.maskKeyframes ? { maskKeyframes: shift(c.maskKeyframes, from) } : {};

/** Exact operations used by web AGENT_COMMANDS; existing native manual operations are unchanged. */
export function runCommand(tl: Timeline, a: Command): Timeline | { error: string } {
    if (a.op === 'insertMedia' || a.op === 'addText') {
        const media = a.mediaId ? tl.media[a.mediaId] : undefined;
        const kind = a.op === 'addText' ? 'text' : media?.kind as TrackKind;
        const lane = tl.tracks.find(t => t.kind === kind && !t.locked);
        if (!lane) return fail();
        const seq = tl.seq + 1;
        const start = a.start ?? laneEnd(tl, lane.id);
        const item = kind === 'text'
            ? { id: `t${seq}`, text: clean(a.text!), start, len: a.len!, x: .5, y: .85, size: 6, trackId: lane.id }
            : { id: `${kind[0]}${seq}`, mediaId: a.mediaId!, in: 0, len: Math.min(media!.frames!, MAX - start), start, trackId: lane.id, volume: 1, ...(kind === 'video' ? { transition: 0 } : {}) };
        return checked({ ...tl, seq, [kind]: [...tl[kind], item] });
    }
    const kind = a.op === 'setText' ? 'text' : a.kind!;
    const item: Item | undefined = tl[kind].find(c => c.id === a.id);
    if (!item || tl.tracks.find(t => t.id === item.trackId)?.locked) return fail();
    const update = (patch: Partial<Item>) => checked({ ...tl, [kind]: tl[kind].map(c => c.id === item.id ? { ...c, ...patch, id: c.id } : c) });
    switch (a.op) {
        case 'split': {
            const offset = a.frame! - item.start;
            if (!Number.isInteger(offset) || offset < 1 || offset >= item.len) return fail();
            const seq = tl.seq + 1;
            const first = { ...item, ...animation(item, 0), ...masks(item, 0), len: offset, ...fades(item, kind, offset) };
            const second = { ...item, ...words(item, offset), ...animation(item, offset), ...(item.speedCurve ? { speedCurve: shift(item.speedCurve, offset) } : {}),
                ...masks(item, offset), id: `${kind[0]}${seq}`, start: a.frame!, len: item.len - offset, ...fades(item, kind, item.len - offset),
                ...(kind !== 'text' ? { in: sourceFrame(item, offset) } : {}), ...(kind === 'video' ? { transition: 0 } : {}) };
            return checked({ ...tl, seq, [kind]: tl[kind].flatMap(c => c.id === item.id ? [first, second] : [c]) });
        }
        case 'trim': {
            const from = a.edge === 'in', delta = a.frames!, offset = from ? delta : 0, len = item.len + (from ? -delta : delta);
            return update({ len, ...words(item, offset), ...animation(item, offset), ...(item.speedCurve ? { speedCurve: shift(item.speedCurve, offset) } : {}),
                ...masks(item, offset), ...fades(item, kind, len), ...(from ? { start: item.start + delta, ...(kind !== 'text' ? { in: sourceFrame(item, delta) } : {}) } : {}) });
        }
        case 'move': return update({ start: Math.min(Math.max(0, Math.round(a.start!)), MAX - item.len), trackId: item.trackId });
        case 'remove': return checked({ ...tl, [kind]: tl[kind].filter(c => c.id !== item.id).map(c => a.ripple && c.trackId === item.trackId && c.start >= item.start + item.len ? { ...c, start: c.start - item.len } : c) });
        case 'duplicate': {
            const seq = tl.seq + 1;
            return checked({ ...tl, seq, [kind]: [...tl[kind], { ...item, id: `${kind[0]}${seq}`, start: item.start + item.len }] });
        }
        case 'setVolume': return update({ volume: a.volume });
        case 'setText': return update({ text: clean(a.text!), ...(clean(a.text!) !== (item as TextClip).text && item.words?.length ? { words: [] } : {}) });
        case 'setSpeed': {
            if (kind === 'text' || ['image', 'graphic'].includes(tl.media[item.mediaId!].kind!)) return fail();
            const rate = a.rate!, len = Math.max(1, Math.floor(advance(item, item.len) / rate));
            const lower = Math.min(sourceFrame(item, 0), sourceFrame(item, item.len - 1));
            return update({ rate, len, speedCurve: [], ...(item.animation ? { animation: { ...item.animation, offset: 0, span: len } } : {}),
                ...(item.reverse ? { in: lower + (len - 1) * rate } : {}), keyframes: [], parameterKeyframes: [], maskKeyframes: [], ...fades(item, kind, len) });
        }
        default: return fail();
    }
}
export const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
