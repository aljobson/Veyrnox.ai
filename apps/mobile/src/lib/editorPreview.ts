import type { ApiClient } from './api';
import type { Clip, Media, Timeline } from './nativeEditorModel';

const LIBRARY_ID = /^j-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface ActiveEditorMedia {
    readonly clip: Clip;
    readonly media: Media;
}

export interface EditorMediaSource {
    readonly uri: string;
    readonly kind: 'video' | 'image';
}

function safeHttpsUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch {
        return null;
    }
}

export function activeEditorMedia(timeline: Timeline, frame: number): ActiveEditorMedia | null {
    const hidden = new Set(timeline.tracks.filter((track) => track.kind === 'video' && track.hidden).map((track) => track.id));
    for (let index = timeline.video.length - 1; index >= 0; index -= 1) {
        const clip = timeline.video[index];
        if (hidden.has(clip.trackId || '') || frame < clip.start || frame >= clip.start + clip.len) continue;
        const media = timeline.media[clip.mediaId || ''];
        if (media?.kind === 'video' || media?.kind === 'image') return { clip, media };
    }
    return null;
}

export async function resolveEditorMediaSource(api: Pick<ApiClient, 'request'>, media: Media): Promise<EditorMediaSource | null> {
    const kind = media.kind === 'video' || media.kind === 'image' ? media.kind : null;
    if (!kind) return null;

    let body: { url?: unknown; content_type?: unknown; mime_type?: unknown };
    if (media.assetSource) {
        const { projectId, assetId } = media.assetSource;
        body = await api.request(`/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/download`);
    } else {
        const match = LIBRARY_ID.exec(media.id);
        if (!match) return null;
        body = await api.request(`/api/v1/jobs/${encodeURIComponent(match[1])}/asset`);
    }

    const uri = safeHttpsUrl(body.url);
    const contentType = String(body.content_type || body.mime_type || '').toLowerCase();
    if (!uri || (kind === 'video' ? !contentType.startsWith('video/') : !contentType.startsWith('image/'))) return null;
    return { uri, kind };
}

export function editorSourceTimeSeconds(clip: Clip, frame: number, fps: number): number {
    const elapsed = Math.max(0, frame - clip.start);
    const rate = Math.max(0.1, clip.rate ?? 1);
    const sourceFrame = clip.reverse ? Math.max(0, (clip.in ?? 0) - elapsed * rate) : Math.max(0, (clip.in ?? 0) + elapsed * rate);
    return sourceFrame / Math.max(1, fps);
}
