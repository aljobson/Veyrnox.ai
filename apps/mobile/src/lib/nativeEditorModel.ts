import { upgradeSequence } from '../../../../app/veyrnox/_lib/editorSequence.mjs';
import { slicedWords } from '../../../../app/veyrnox/_lib/editorWords.mjs';
import { slicedAnimation } from '../../../../app/veyrnox/_lib/editorAnimation.mjs';
import { sliceMaskKeyframes as webSliceMaskKeyframes } from '../../../../app/veyrnox/_lib/editorMask.mjs';
import { fontMetadataProblem } from '../../../../app/veyrnox/_lib/editorOrganization.mjs';
// The web caller supplies the retained length; today's helper preserves keys beyond that boundary.
const sliceMaskKeyframes = webSliceMaskKeyframes as (clip: Clip | TextClip, from: number, len: number) => ReturnType<typeof webSliceMaskKeyframes>;
import { sourceFrame, shiftedSpeedKeys } from '../../../../app/veyrnox/_lib/editorSpeed.mjs';
import { rawText, t } from './i18n';
export const DEFAULT_TEXT_STYLE = { font: 'sans-serif', weight: 'bold', align: 'center', color: '#ffffff', stroke: '#000000', strokeWidth: 0, background: '#000000', backgroundOpacity: 0 } as const;
export type TrackKind = 'video' | 'audio' | 'text';
export type Selection = { track: TrackKind; id: string };
export type Canvas = { aspect_ratio: '16:9' | '9:16' | '1:1'; frame_rate: 24 | 25 | 30 | 60 };
export type Media = {
    id: string; name?: string; kind?: string; frames?: number; hasAudio?: boolean; width?: number; height?: number;
    sourceName?: string; folder?: string; attribution?: { credit: string; usage: string; url: string };
    originalAudio?: { version: 1; presetId: string };
    assetSource?: { projectId: string; assetId: string };
};
export type TimedFields = {
    words?: { text: string; start: number; len: number }[];
    keyframes?: { frame: number; [key: string]: unknown }[];
    parameterKeyframes?: { frame: number; [key: string]: unknown }[];
    maskKeyframes?: { frame: number; [key: string]: unknown }[];
    speedCurve?: { frame: number; rate: number }[]; freezeFrame?: number;
};
export type Animation = { in?: string; out?: string; duration?: number; combo?: string; period?: number; amount?: number; offset?: number; span?: number };
export type ColourAdjustment = {
    exposure: number; temperature: number; tint: number; shadows: number; highlights: number; gamma: number;
    hsl: Record<string, { hue: number; saturation: number; luminance: number }>;
    curves: Record<string, { x: number; y: number }[]>;
};
export type Clip = TimedFields & {
    mask?: string;
    maskSettings?: { x: number; y: number; width: number; height: number; rotation: number; feather: number; inverted: boolean };
    smartPicture?: { denoise: number; keyEnabled: boolean; keyColor: string; keyTolerance: number; keyFeather: number; despill: number;
        light: number; lightX: number; lightY: number; lightRadius: number };
    colourAdjustment?: ColourAdjustment; crop?: { x: number; y: number; width: number; height: number }; blend?: string;
    background?: { type: 'none' | 'solid' | 'blur' | 'image'; color: string; blur: number; mediaId: string };
    id: string; mediaId?: string; start: number; in?: number; len: number; trackId?: string;
    volume?: number; transition?: number; transitionType?: string; rate?: number; reverse?: boolean; preservePitch?: boolean;
    fadeIn?: number; fadeOut?: number; pan?: number; groupId?: string; fit?: 'contain' | 'cover';
    effect?: { type: string; intensity: number }; animation?: Animation;
    transform?: { x?: number; y?: number; scale?: number; rotation?: number; opacity?: number; flipX?: boolean; flipY?: boolean };
    filter?: { brightness?: number; contrast?: number; saturate?: number; hue?: number; blur?: number };
    eq?: { low: number; mid: number; high: number };
    audioProcessing?: { pitch: number; voice: string; noiseReduction: number; noiseStart: number; noiseLength: number; gateDb: number };
    audioEffects?: { width: number; tremoloRate: number; tremoloDepth: number; echoDelay: number; echoDecay: number; echoRepeats: number; echoMix: number };
};
export type TextClip = TimedFields & {
    caption?: boolean; wordsEstimated?: boolean;
    wordStyle?: { mode: 'none' | 'highlight' | 'karaoke' | 'word'; color: string };
    id: string; text: string; start: number; len: number; trackId?: string; x: number; y: number; size: number;
    groupId?: string; animation?: Animation;
    style?: { font?: string; weight?: string; align?: string; color?: string; stroke?: string; strokeWidth?: number; background?: string; backgroundOpacity?: number;
        italic?: boolean; underline?: boolean; letterSpacing?: number; lineHeight?: number;
        shadowColor?: string; shadowOpacity?: number; shadowBlur?: number; shadowX?: number; shadowY?: number };
};
export type EditorTrack = { id: string; kind: TrackKind; name: string; locked: boolean; muted: boolean; hidden: boolean; solo?: boolean };
export type Marker = { id: string; frame: number; label: string; color: string };
export type CustomFont = { family: string; name: string; sourceName: string; sha256: string; bytes: number; format: 'ttf' | 'otf' | 'woff' | 'woff2';
    rights: { credit: string; usage: string; url: string } };
export type Timeline = {
    schemaVersion: 3; fps: number; seq: number; aspect: 'source' | Canvas['aspect_ratio']; background: string;
    media: Record<string, Media>; video: Clip[]; audio: Clip[]; text: TextClip[]; tracks: EditorTrack[]; markers: Marker[];
    fonts?: CustomFont[];
};
export const validCustomFonts = (timeline: Pick<Timeline, 'fonts'>): CustomFont[] => Array.isArray(timeline.fonts)
    ? timeline.fonts.filter((font): font is CustomFont => !fontMetadataProblem(font)) : [];
export type Clipboard = { items: readonly { track: TrackKind; item: Clip | TextClip }[] } | null;

const starterTracks = (): EditorTrack[] => [
    { id: 'video-0', kind: 'video', name: 'Video 1', locked: false, muted: false, hidden: false },
    { id: 'audio-0', kind: 'audio', name: 'Audio 1', locked: false, muted: false, hidden: false },
    { id: 'text-0', kind: 'text', name: 'Text 1', locked: false, muted: false, hidden: false },
];

export const emptyTimeline = (): Timeline => ({
    schemaVersion: 3, fps: 30, seq: 0, aspect: '16:9', background: '#000000', media: {}, video: [], audio: [], text: [], tracks: starterTracks(), markers: [],
});

export const canvasOf = (value: unknown): Canvas => {
    const canvas = value && typeof value === 'object' ? value as Partial<Canvas> : {};
    return {
        aspect_ratio: canvas.aspect_ratio === '9:16' || canvas.aspect_ratio === '1:1' ? canvas.aspect_ratio : '16:9',
        frame_rate: canvas.frame_rate === 24 || canvas.frame_rate === 25 || canvas.frame_rate === 60 ? canvas.frame_rate : 30,
    };
};

export function timelineOf(value: unknown): Timeline {
    if (!value || typeof value !== 'object') return emptyTimeline();
    const input = value as Partial<Omit<Timeline, 'schemaVersion'>> & { schemaVersion?: number };
    if (!Array.isArray(input.video) || !Array.isArray(input.audio) || !Array.isArray(input.text) || !input.media || typeof input.media !== 'object') return emptyTimeline();
    const raw = (input.schemaVersion === 2 ? upgradeSequence(input) : input) as Partial<Timeline> & Pick<Timeline, 'video' | 'audio' | 'text' | 'media'>;
    const { fonts: rawFonts, ...rawWithoutFonts } = raw;
    const tracks = Array.isArray(raw.tracks) && raw.tracks.length ? raw.tracks.map((track) => ({
        id: String(track.id), kind: track.kind, name: String(track.name), locked: !!track.locked, muted: !!track.muted, hidden: !!track.hidden,
        ...(typeof track.solo === 'boolean' ? { solo: track.solo } : {}),
    })) : starterTracks();
    const trackId = (kind: TrackKind, current?: string) => tracks.some((track) => track.id === current && track.kind === kind) ? current : tracks.find((track) => track.kind === kind)?.id;
    const media = Object.fromEntries(Object.entries(raw.media).map(([id, item]) => {
        const source = item as Media;
        const kind = ['video', 'audio', 'image', 'graphic'].includes(String(source.kind)) ? String(source.kind) : 'video';
        return [id, { ...source, id, kind, frames: Math.max(1, Math.round(Number(source.frames) || 90)), name: String(source.name || t('nativeEditorModel.untitled')).slice(0, 120), hasAudio:
        source.hasAudio ?? kind === 'audio', width: Number(source.width) || 0, height: Number(source.height) || 0 }];
    })) as Record<string, Media>;
    const clip = (kind: 'video' | 'audio', item: Clip) => ({ ...item, start: Math.max(0, Math.round(Number(item.start) || 0)), in: Math.max(0, Number(item.in) || 0), len: Math.max(1,
        Math.round(Number(item.len) || 1)), trackId: trackId(kind, item.trackId), volume: item.volume ?? 1, ...(kind === 'video' ? { transition: item.transition ?? 0 } : {}) });
    return {
        ...emptyTimeline(), ...rawWithoutFonts, schemaVersion: 3, fps: 30, media, tracks, markers: Array.isArray(raw.markers) ? raw.markers : [],
        ...(rawFonts !== undefined ? { fonts: rawFonts } : {}),
        video: raw.video.map((item) => clip('video', item)),
        audio: raw.audio.map((item) => clip('audio', item)),
        text: raw.text.map((item) => ({ ...item, start: Math.max(0, Math.round(Number(item.start) || 0)), len: Math.max(1, Math.round(Number(item.len) || 1)), trackId: trackId('text',
        item.trackId), text: String(item.text || t('nativeEditorModel.yourtext')).slice(0, 1000), x: Number.isFinite(item.x) ? item.x : .5, y: Number.isFinite(item.y) ? item.y : .85, size:
        Math.max(2, Math.min(40, Math.round(Number(item.size) || 6))) })),
    } as Timeline;
}

export const framesIn = (timeline: Timeline) => Math.max(0, ...[...timeline.video, ...timeline.audio, ...timeline.text].map((clip) => clip.start + clip.len));
export const clipAt = (timeline: Timeline, selection: Selection | null): Clip | TextClip | undefined => selection ? timeline[selection.track].find((item) => item.id === selection.id) : undefined;
export const selectionItems = (timeline: Timeline, selections: readonly Selection[]) => selections.flatMap((selection) => {
    const item = clipAt(timeline, selection);
    return item ? [{ track: selection.track, item }] : [];
});

export function updateClip(timeline: Timeline, selection: Selection, patch: Partial<Clip & TextClip>): Timeline {
    return { ...timeline, [selection.track]: timeline[selection.track].map((item) => item.id === selection.id ? { ...item, ...patch, id: item.id } : item) } as Timeline;
}

// Shared slicing math, used by both explicit splits and insertion into an occupied lane.
function splitPair(item: Clip | TextClip, kind: TrackKind, frame: number, seq: number): [Clip | TextClip, Clip | TextClip] {
    const offset = frame - item.start, clip = item as Clip;
    const fades = (len: number) => kind === 'text' ? {} : { fadeIn: Math.min(clip.fadeIn || 0, len), fadeOut: Math.min(clip.fadeOut || 0, len) };
    const first = { ...item, ...slicedAnimation(item, 0),
        ...(item.maskKeyframes ? { maskKeyframes: sliceMaskKeyframes(item, 0, offset) } : {}), len: offset, ...fades(offset) };
    const second = { ...item, ...slicedWords(item, offset), ...slicedAnimation(item, offset),
        ...(item.speedCurve ? { speedCurve: shiftedSpeedKeys(item, offset) } : {}),
        ...(item.maskKeyframes ? { maskKeyframes: sliceMaskKeyframes(item, offset, item.len - offset) } : {}),
        id: `${kind[0]}${seq}`, start: frame, len: item.len - offset, ...fades(item.len - offset),
        ...(kind !== 'text' ? { in: sourceFrame(item, offset) } : {}), ...(kind === 'video' ? { transition: 0 } : {}) };
    return [first, second];
}
export function splitClip(timeline: Timeline, selection: Selection, frame: number): Timeline | null {
    const item = clipAt(timeline, selection);
    if (!item || !Number.isInteger(frame) || frame <= item.start || frame >= item.start + item.len
        || timeline.tracks.some(track => track.id === item.trackId && track.locked)) return null;
    const seq = timeline.seq + 1;
    const pair = splitPair(item, selection.track, frame, seq);
    return { ...timeline, seq, [selection.track]: timeline[selection.track].flatMap(candidate => candidate.id === item.id ? pair : [candidate]) } as Timeline;
}

/** Build every requested split against one immutable candidate so the caller can commit and undo the batch once. */
export function splitClipAtFrames(timeline: Timeline, selection: Selection, frames: readonly number[]): Timeline | null {
    const item = clipAt(timeline, selection);
    if (!item || timeline.tracks.some(track => track.id === item.trackId && track.locked)) return null;
    const cuts = [...new Set(frames)].sort((a, b) => b - a);
    if (!cuts.length || cuts.some(frame => !Number.isInteger(frame) || frame <= item.start || frame >= item.start + item.len)) return null;
    let candidate = timeline;
    for (const frame of cuts) {
        const next = splitClip(candidate, selection, frame);
        if (!next) return null;
        candidate = next;
    }
    return candidate;
}

export function removeSelections(timeline: Timeline, selections: readonly Selection[], ripple: 'none' | 'lane' | 'all'): Timeline {
    let next = timeline;
    for (const selection of selections) {
        const item = clipAt(next, selection);
        if (!item || timeline.tracks.some(track => track.id === item.trackId && track.locked)) continue;
        const mode = item.freezeFrame !== undefined ? 'lane' : ripple;
        const list = next[selection.track].filter((candidate) => candidate.id !== selection.id).map((candidate) => {
            const sameLane = candidate.trackId === item.trackId;
            const shouldRipple = candidate.start >= item.start + item.len && (mode === 'all' || (mode === 'lane' && sameLane));
            return shouldRipple ? { ...candidate, start: Math.max(0, candidate.start - item.len) } : candidate;
        });
        next = { ...next, [selection.track]: list } as Timeline;
    }
    return next;
}

export function copySelections(timeline: Timeline, selections: readonly Selection[]): Clipboard {
    const items = selectionItems(timeline, selections).map(({ track, item }) => ({ track, item: { ...item } }));
    return items.length ? { items } : null;
}

export function pasteClipboard(timeline: Timeline, clipboard: Clipboard, frame: number): { timeline: Timeline; selections: Selection[] } | null {
    if (!clipboard?.items.length) return null;
    const origin = Math.min(...clipboard.items.map(({ item }) => item.start));
    let seq = timeline.seq;
    const additions: Record<TrackKind, (Clip | TextClip)[]> = { video: [], audio: [], text: [] };
    const selections: Selection[] = [];
    const tracks = [...timeline.tracks], restored = new Map<string, string>();
    for (const { track, item } of clipboard.items) {
        seq += 1;
        const id = `${track[0]}${seq}`;
        // The clip's original track may be gone (an emptied extra track is removed): recreate one lane per missing track so simultaneous clips never share a lane.
        let lane = item.trackId;
        if (!tracks.some((candidate) => candidate.id === lane && candidate.kind === track)) {
            const key = `${track}:${item.trackId}`;
            if (!restored.has(key)) {
                seq += 1;
                restored.set(key, `${track}-${seq}`);
                tracks.push({ id: `${track}-${seq}`, kind: track, name: `${track[0].toUpperCase()}${track.slice(1)} ${tracks.filter((candidate) => candidate.kind === track).length + 1}`, locked:
                false, muted: false, hidden: false });
            }
            lane = restored.get(key);
        }
        additions[track].push({ ...item, id, trackId: lane, start: Math.max(0, frame + item.start - origin) });
        selections.push({ track, id });
    }
    // Insert, never overlap: on each track the existing items from the insert point on move right by the pasted span;
    // an item the insert point falls inside is split there, and only its tail moves.
    const next = { ...timeline, seq, tracks } as Timeline;
    for (const track of ['video', 'audio', 'text'] as const) {
        const added = additions[track];
        if (!added.length) continue;
        const lanes = new Map<string | undefined, (Clip | TextClip)[]>();
        for (const item of added) lanes.set(item.trackId, [...(lanes.get(item.trackId) ?? []), item]);
        let existing = timeline[track] as (Clip | TextClip)[];
        for (const [lane, items] of lanes) {
            const from = Math.min(...items.map((item) => item.start));
            const span = Math.max(...items.map((item) => item.start + item.len)) - from;
            existing = existing.flatMap((item) => {
                if (item.trackId !== lane || item.start + item.len <= from) return [item];
                if (item.start >= from) return [{ ...item, start: item.start + span }];
                const [head, tail] = splitPair(item, track, from, ++seq);
                return [head, { ...tail, start: from + span }];
            });
        }
        (next as Record<TrackKind, (Clip | TextClip)[]>)[track] = [...existing, ...added];
    }
    return { timeline: { ...next, seq, tracks }, selections };
}

export function duplicateSelections(timeline: Timeline, selections: readonly Selection[]): { timeline: Timeline; selections: Selection[] } | null {
    const clipboard = copySelections(timeline, selections);
    if (!clipboard) return null;
    const end = Math.max(...clipboard.items.map(({ item }) => item.start + item.len));
    return pasteClipboard(timeline, clipboard, end);
}

/**
 * Swap a clip with its neighbour on the same lane (earlier or later by start), keeping the pair's combined span and the gap
 * between them, so nothing else moves and nothing overlaps. Returns null at a lane end, for an unknown clip, or when the pair
 * already overlaps or the swap would cover another clip on the lane (the controls use this as their eligibility check).
 */
export function moveClip(timeline: Timeline, selection: Selection, direction: -1 | 1): Timeline | null {
    const item = clipAt(timeline, selection);
    if (!item) return null;
    const lane = (timeline[selection.track] as (Clip | TextClip)[]).map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => candidate.trackId === item.trackId)
        .sort((a, b) => a.candidate.start - b.candidate.start || a.index - b.index);
    const at = lane.findIndex(({ candidate }) => candidate.id === item.id);
    const other = lane[at + direction]?.candidate;
    if (!other) return null;
    const [first, second] = direction === 1 ? [item, other] : [other, item];
    const gap = second.start - (first.start + first.len);
    if (gap < 0) return null;
    const starts = new Map([[second.id, first.start], [first.id, first.start + second.len + gap]]);
    const moved = [{ start: first.start, len: second.len }, { start: first.start + second.len + gap, len: first.len }];
    // A third clip on the lane (reachable when earlier drags left overlaps) must not end up covered by either moved clip.
    if (lane.some(({ candidate }) => !starts.has(candidate.id) && moved.some((m) => m.start < candidate.start + candidate.len && candidate.start < m.start + m.len))) return null;
    return { ...timeline, [selection.track]: timeline[selection.track].map((candidate) => starts.has(candidate.id) ? { ...candidate, start: starts.get(candidate.id)! } : candidate) } as Timeline;
}

export function groupSelections(timeline: Timeline, selections: readonly Selection[], grouped: boolean): Timeline {
    if (!grouped) {
        const groups = new Set(selectionItems(timeline, selections).map(({ item }) => item.groupId).filter(Boolean));
        return (['video', 'audio', 'text'] as const).reduce((next, track) => ({ ...next, [track]: next[track].map((item) => groups.has(item.groupId) ? { ...item, groupId: undefined } : item) }),
        timeline) as Timeline;
    }
    if (selections.length < 2) return timeline;
    const groupId = `g${timeline.seq + 1}`;
    const keys = new Set(selections.map(({ track, id }) => `${track}:${id}`));
    return (['video', 'audio', 'text'] as const).reduce((next, track) => ({ ...next, seq: timeline.seq + 1, [track]: next[track].map((item) => keys.has(`${track}:${item.id}`) ? { ...item,
        groupId } : item) }), timeline) as Timeline;
}

export function addTrack(timeline: Timeline, kind: TrackKind): Timeline {
    const seq = timeline.seq + 1;
    const count = timeline.tracks.filter((track) => track.kind === kind).length + 1;
    return { ...timeline, seq, tracks: [...timeline.tracks, { id: `${kind}-${seq}`, kind, name: `${kind[0].toUpperCase()}${kind.slice(1)} ${count}`, locked: false, muted: false, hidden: false }] };
}

export function addMarker(timeline: Timeline, frame: number): Timeline {
    const seq = timeline.seq + 1;
    return { ...timeline, seq, markers: [...timeline.markers, { id: `m${seq}`, frame: Math.max(0, Math.round(frame)), label: rawText(t('nativeEditorModel.marker', { value1:
        timeline.markers.length + 1 })), color: '#3ee6c4' }].sort((a, b) => a.frame - b.frame) };
}

const clipsOnTrack = (timeline: Timeline, track: EditorTrack) => (timeline[track.kind] as (Clip | TextClip)[]).filter((item) => item.trackId === track.id);

/** A track can be removed when it holds no clips and is not the last track of its kind. */
export function canRemoveTrack(timeline: Timeline, trackId: string): boolean {
    const track = timeline.tracks.find((item) => item.id === trackId);
    return !!track && !clipsOnTrack(timeline, track).length && timeline.tracks.filter((item) => item.kind === track.kind).length > 1;
}

export function removeTrack(timeline: Timeline, trackId: string): Timeline | null {
    return canRemoveTrack(timeline, trackId) ? { ...timeline, tracks: timeline.tracks.filter((item) => item.id !== trackId) } : null;
}

/** Empty tracks beyond the first of each kind: the ones that block server export and are safe to drop automatically. */
export function emptyExtraTracks(timeline: Timeline): EditorTrack[] {
    return timeline.tracks.filter((track, index) => timeline.tracks.findIndex((item) => item.kind === track.kind) !== index && !clipsOnTrack(timeline, track).length);
}

/** After deleting clips: drop only the named tracks that are now empty extras (never the first track of a kind). */
export function pruneEmptiedExtraTracks(timeline: Timeline, trackIds: readonly (string | undefined)[]): Timeline {
    const extras = new Set(emptyExtraTracks(timeline).map((track) => track.id));
    const drop = new Set(trackIds.filter((id): id is string => !!id && extras.has(id)));
    return drop.size ? { ...timeline, tracks: timeline.tracks.filter((track) => !drop.has(track.id)) } : timeline;
}
