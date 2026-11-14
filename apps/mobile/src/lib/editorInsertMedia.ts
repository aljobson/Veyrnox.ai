import { SEQUENCE_MAX } from './editorTimeline';
import { addTrack, type Media, type Selection, type Timeline } from './nativeEditorModel';

export const clampFrame = (frame: number) => Math.min(SEQUENCE_MAX - 1, Math.max(0, Math.round(frame)));

export function holdsClip(timeline: Timeline, mediaId: string): boolean {
    return [...timeline.video, ...timeline.audio].some(clip => clip.mediaId === mediaId);
}

export function insertMediaAt(timeline: Timeline, media: Media, at: number): { timeline: Timeline; selection: Selection } | { error: 'track' | 'full' } {
    const kind = media.kind === 'audio' ? 'audio' : 'video';
    const open = timeline.tracks.filter(track => track.kind === kind && !track.locked);
    if (!open.length) return { error: 'track' };
    if ((!Object.hasOwn(timeline.media, media.id) && Object.keys(timeline.media).length >= 40) || timeline[kind].length >= 40) return { error: 'full' };
    const start = clampFrame(at), len = Math.max(1, Math.min(media.frames || 90, SEQUENCE_MAX - start));
    // QA build 50 (F10): never stack a clip over another one. Use the first unlocked track that is
    // free at the playhead; if every one is busy there, the clip goes on a new track (its own layer).
    const free = (trackId: string) => !timeline[kind].some(clip => clip.trackId === trackId && clip.start < start + len && start < clip.start + clip.len);
    const base = open.some(track => free(track.id)) ? timeline : addTrack(timeline, kind);
    const trackId = open.find(track => free(track.id))?.id ?? base.tracks[base.tracks.length - 1].id;
    const seq = base.seq + 1;
    const clip = { id: `${kind[0]}${seq}`, mediaId: media.id, start, in: 0, len, trackId, volume: 1, transition: 0, rate: 1 };
    return {
        timeline: { ...base, seq, media: { ...base.media, [media.id]: media }, [kind]: [...base[kind], clip] },
        selection: { track: kind, id: clip.id },
    };
}
