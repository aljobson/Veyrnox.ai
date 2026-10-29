import { SEQUENCE_MAX } from './editorTimeline';
import type { Media, Selection, Timeline } from './nativeEditorModel';

export const clampFrame = (frame: number) => Math.min(SEQUENCE_MAX - 1, Math.max(0, Math.round(frame)));

export function holdsClip(timeline: Timeline, mediaId: string): boolean {
    return [...timeline.video, ...timeline.audio].some(clip => clip.mediaId === mediaId);
}

export function insertMediaAt(timeline: Timeline, media: Media, at: number): { timeline: Timeline; selection: Selection } | { error: 'track' | 'full' } {
    const kind = media.kind === 'audio' ? 'audio' : 'video';
    const trackId = timeline.tracks.find(track => track.kind === kind && !track.locked)?.id;
    if (!trackId) return { error: 'track' };
    if ((!Object.hasOwn(timeline.media, media.id) && Object.keys(timeline.media).length >= 40) || timeline[kind].length >= 40) return { error: 'full' };
    const start = clampFrame(at), seq = timeline.seq + 1;
    const clip = { id: `${kind[0]}${seq}`, mediaId: media.id, start, in: 0, len: Math.max(1, Math.min(media.frames || 90, SEQUENCE_MAX - start)), trackId, volume: 1, transition: 0, rate: 1 };
    return {
        timeline: { ...timeline, seq, media: { ...timeline.media, [media.id]: media }, [kind]: [...timeline[kind], clip] },
        selection: { track: kind, id: clip.id },
    };
}
