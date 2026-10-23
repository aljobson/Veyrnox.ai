export type TrackKind = 'video' | 'audio' | 'text';
export type Selection = { track: TrackKind; id: string };
export type Canvas = { aspect_ratio: '16:9' | '9:16' | '1:1'; frame_rate: 24 | 25 | 30 | 60 };
export type Media = { id: string; name?: string; kind?: string; frames?: number; hasAudio?: boolean; width?: number; height?: number };
export type Clip = {
    id: string; mediaId?: string; start: number; in?: number; len: number; trackId?: string;
    volume?: number; transition?: number; transitionType?: string; rate?: number; reverse?: boolean;
    fadeIn?: number; fadeOut?: number; pan?: number; groupId?: string; fit?: 'contain' | 'cover';
    effect?: { type: string; intensity: number }; animation?: { in?: string; out?: string; duration?: number };
    transform?: { x?: number; y?: number; scale?: number; rotation?: number; opacity?: number; flipX?: boolean; flipY?: boolean };
    filter?: { brightness?: number; contrast?: number; saturate?: number; hue?: number; blur?: number };
    eq?: { low?: number; mid?: number; high?: number };
};
export type TextClip = {
    id: string; text: string; start: number; len: number; trackId?: string; x: number; y: number; size: number;
    groupId?: string; animation?: { in?: string; out?: string; duration?: number };
    style?: { font?: string; weight?: string; align?: string; color?: string; stroke?: string; strokeWidth?: number; background?: string; backgroundOpacity?: number };
};
export type EditorTrack = { id: string; kind: TrackKind; name: string; locked: boolean; muted: boolean; hidden: boolean };
export type Marker = { id: string; frame: number; label: string; color: string };
export type Timeline = {
    schemaVersion: 3; fps: number; seq: number; aspect: 'source' | Canvas['aspect_ratio']; background: string;
    media: Record<string, Media>; video: Clip[]; audio: Clip[]; text: TextClip[]; tracks: EditorTrack[]; markers: Marker[];
};
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
    const raw = value as Partial<Timeline> & { schemaVersion?: number };
    if (!Array.isArray(raw.video) || !Array.isArray(raw.audio) || !Array.isArray(raw.text) || !raw.media || typeof raw.media !== 'object') return emptyTimeline();
    const tracks = Array.isArray(raw.tracks) && raw.tracks.length ? raw.tracks.map((track) => ({
        id: String(track.id), kind: track.kind, name: String(track.name), locked: !!track.locked, muted: !!track.muted, hidden: !!track.hidden,
    })) : starterTracks();
    const trackId = (kind: TrackKind, current?: string) => tracks.some((track) => track.id === current && track.kind === kind) ? current : tracks.find((track) => track.kind === kind)?.id;
    const media = Object.fromEntries(Object.entries(raw.media).map(([id, item]) => {
        const source = item as Media;
        const kind = ['video', 'audio', 'image', 'graphic'].includes(String(source.kind)) ? String(source.kind) : 'video';
        return [id, { ...source, id, kind, frames: Math.max(1, Math.round(Number(source.frames) || 90)), name: String(source.name || 'Untitled').slice(0, 120), hasAudio: source.hasAudio ?? kind === 'audio', width: Number(source.width) || 0, height: Number(source.height) || 0 }];
    })) as Record<string, Media>;
    const clip = (kind: 'video' | 'audio', item: Clip) => ({ ...item, start: Math.max(0, Math.round(Number(item.start) || 0)), in: Math.max(0, Number(item.in) || 0), len: Math.max(1, Math.round(Number(item.len) || 1)), trackId: trackId(kind, item.trackId), volume: item.volume ?? 1, ...(kind === 'video' ? { transition: item.transition ?? 0 } : {}) });
    return {
        ...emptyTimeline(), ...raw, schemaVersion: 3, fps: 30, media, tracks, markers: Array.isArray(raw.markers) ? raw.markers : [],
        video: raw.video.map((item) => clip('video', item)),
        audio: raw.audio.map((item) => clip('audio', item)),
        text: raw.text.map((item) => ({ ...item, start: Math.max(0, Math.round(Number(item.start) || 0)), len: Math.max(1, Math.round(Number(item.len) || 1)), trackId: trackId('text', item.trackId), text: String(item.text || 'Your text').slice(0, 1000), x: Number.isFinite(item.x) ? item.x : .5, y: Number.isFinite(item.y) ? item.y : .85, size: Math.max(2, Math.min(40, Math.round(Number(item.size) || 6))) })),
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

export function splitClip(timeline: Timeline, selection: Selection, frame: number): Timeline | null {
    const item = clipAt(timeline, selection);
    if (!item || frame <= item.start || frame >= item.start + item.len) return null;
    const offset = frame - item.start;
    const seq = timeline.seq + 1;
    const first = { ...item, len: offset };
    const second = { ...item, id: `${selection.track[0]}${seq}`, start: frame, len: item.len - offset, ...('in' in item ? { in: (item.in ?? 0) + offset } : {}) };
    return { ...timeline, seq, [selection.track]: timeline[selection.track].flatMap((candidate) => candidate.id === item.id ? [first, second] : [candidate]) } as Timeline;
}

export function removeSelections(timeline: Timeline, selections: readonly Selection[], ripple: 'none' | 'lane' | 'all'): Timeline {
    let next = timeline;
    for (const selection of selections) {
        const item = clipAt(next, selection);
        if (!item) continue;
        const list = next[selection.track].filter((candidate) => candidate.id !== selection.id).map((candidate) => {
            const sameLane = candidate.trackId === item.trackId;
            const shouldRipple = candidate.start >= item.start + item.len && (ripple === 'all' || (ripple === 'lane' && sameLane));
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
    for (const { track, item } of clipboard.items) {
        seq += 1;
        const id = `${track[0]}${seq}`;
        additions[track].push({ ...item, id, start: Math.max(0, frame + item.start - origin) });
        selections.push({ track, id });
    }
    return { timeline: { ...timeline, seq, video: [...timeline.video, ...additions.video as Clip[]], audio: [...timeline.audio, ...additions.audio as Clip[]], text: [...timeline.text, ...additions.text as TextClip[]] }, selections };
}

export function duplicateSelections(timeline: Timeline, selections: readonly Selection[]): { timeline: Timeline; selections: Selection[] } | null {
    const clipboard = copySelections(timeline, selections);
    if (!clipboard) return null;
    const end = Math.max(...clipboard.items.map(({ item }) => item.start + item.len));
    return pasteClipboard(timeline, clipboard, end);
}

export function groupSelections(timeline: Timeline, selections: readonly Selection[], grouped: boolean): Timeline {
    if (!grouped) {
        const groups = new Set(selectionItems(timeline, selections).map(({ item }) => item.groupId).filter(Boolean));
        return (['video', 'audio', 'text'] as const).reduce((next, track) => ({ ...next, [track]: next[track].map((item) => groups.has(item.groupId) ? { ...item, groupId: undefined } : item) }), timeline) as Timeline;
    }
    if (selections.length < 2) return timeline;
    const groupId = `g${timeline.seq + 1}`;
    const keys = new Set(selections.map(({ track, id }) => `${track}:${id}`));
    return (['video', 'audio', 'text'] as const).reduce((next, track) => ({ ...next, seq: timeline.seq + 1, [track]: next[track].map((item) => keys.has(`${track}:${item.id}`) ? { ...item, groupId } : item) }), timeline) as Timeline;
}

export function addTrack(timeline: Timeline, kind: TrackKind): Timeline {
    const seq = timeline.seq + 1;
    const count = timeline.tracks.filter((track) => track.kind === kind).length + 1;
    return { ...timeline, seq, tracks: [...timeline.tracks, { id: `${kind}-${seq}`, kind, name: `${kind[0].toUpperCase()}${kind.slice(1)} ${count}`, locked: false, muted: false, hidden: false }] };
}

export function addMarker(timeline: Timeline, frame: number): Timeline {
    const seq = timeline.seq + 1;
    return { ...timeline, seq, markers: [...timeline.markers, { id: `m${seq}`, frame: Math.max(0, Math.round(frame)), label: `Marker ${timeline.markers.length + 1}`, color: '#3ee6c4' }].sort((a, b) => a.frame - b.frame) };
}
