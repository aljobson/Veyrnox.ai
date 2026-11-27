import { SEQUENCE_MAX } from './editorTimeline';
import { addTrack, type Media, type Selection, type Timeline } from './nativeEditorModel';

const MAX_TRACKS = 16;

export const clampFrame = (frame: number) => Math.min(SEQUENCE_MAX - 1, Math.max(0, Math.round(frame)));

export function holdsClip(timeline: Timeline, mediaId: string): boolean {
    return [...timeline.video, ...timeline.audio].some(clip => clip.mediaId === mediaId);
}

export function insertMediaAt(timeline: Timeline, media: Media, at: number, preferredTrackId?: string): { timeline: Timeline; selection: Selection; trimmed: boolean } | { error: 'track' | 'full' | 'occupied' } {
    const kind = media.kind === 'audio' ? 'audio' : 'video';
    const open = timeline.tracks.filter(track => track.kind === kind && !track.locked);
    const preferred = preferredTrackId ? open.find(track => track.id === preferredTrackId) : undefined;
    if (!open.length || preferredTrackId && !preferred) return { error: 'track' };
    if ((!Object.hasOwn(timeline.media, media.id) && Object.keys(timeline.media).length >= 40) || timeline[kind].length >= 40) return { error: 'full' };
    const wanted = clampFrame(at);
    // QA build 52 (8.8): a song longer than the cut would stretch the project (a 60 s song made a 5 s edit 1:00:00,
    // black after the clips). Audio that starts inside the video stops at the video's last frame.
    const videoEnd = kind === 'audio' ? timeline.video.reduce((end, clip) => Math.max(end, clip.start + clip.len), 0) : 0;
    const full = Math.max(1, media.frames || 90);
    // Audio parked at or past the video end moves back so it ends with the video instead of stretching the project.
    const start = videoEnd > 0 && wanted >= videoEnd ? Math.max(0, videoEnd - Math.min(full, videoEnd)) : wanted;
    const room = videoEnd > start ? videoEnd - start : SEQUENCE_MAX - start;
    const len = Math.max(1, Math.min(full, room, SEQUENCE_MAX - start));
    // QA build 50 (F10): never stack a clip over another one. When a visual overlaps any existing
    // visual, append a new track so the imported photo/video is the uppermost canonical layer.
    // Non-overlapping clips can reuse the first unlocked gap; audio retains the same lane behaviour.
    const free = (trackId: string) => !timeline[kind].some(clip => clip.trackId === trackId && clip.start < start + len && start < clip.start + clip.len);
    const overlapsVisual = kind === 'video' && timeline.video.some(clip => clip.start < start + len && start < clip.start + clip.len);
    if (preferred && !free(preferred.id)) return { error: 'occupied' };
    const needsTrack = !preferred && (overlapsVisual || !open.some(track => free(track.id)));
    if (needsTrack && timeline.tracks.length >= MAX_TRACKS) return { error: 'full' };
    const base = needsTrack ? addTrack(timeline, kind) : timeline;
    const trackId = preferred?.id ?? (needsTrack ? base.tracks[base.tracks.length - 1].id : open.find(track => free(track.id))!.id);
    const seq = base.seq + 1;
    const clip = { id: `${kind[0]}${seq}`, mediaId: media.id, start, in: 0, len, trackId, volume: 1, transition: 0, rate: 1 };
    return {
        timeline: { ...base, seq, media: { ...base.media, [media.id]: media }, [kind]: [...base[kind], clip] },
        selection: { track: kind, id: clip.id },
        trimmed: videoEnd > 0 && len < full,
    };
}
