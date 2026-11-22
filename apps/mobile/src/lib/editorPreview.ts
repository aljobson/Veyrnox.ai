import { sourceFrame, speedAt } from '../../../../app/veyrnox/_lib/editorSpeed.mjs';
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

export async function resolveEditorMediaSource(api: Pick<ApiClient, 'request'>, media: Media, signal?: AbortSignal): Promise<EditorMediaSource | null> {
    const kind = media.kind === 'video' || media.kind === 'image' ? media.kind : null;
    if (!kind) return null;

    let body: { url?: unknown; content_type?: unknown; mime_type?: unknown };
    if (media.assetSource) {
        const { projectId, assetId } = media.assetSource;
        body = await api.request(`/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/download`, { signal });
    } else {
        const match = LIBRARY_ID.exec(media.id);
        if (!match) return null;
        body = await api.request(`/api/v1/jobs/${encodeURIComponent(match[1])}/asset`, { signal });
    }

    const uri = safeHttpsUrl(body.url);
    const contentType = String(body.content_type || body.mime_type || '').toLowerCase();
    if (!uri || (kind === 'video' ? !contentType.startsWith('video/') : !contentType.startsWith('image/'))) return null;
    return { uri, kind };
}

export function editorSourceTimeSeconds(clip: Clip, frame: number, fps: number): number {
    return Math.max(0, sourceFrame({ ...clip, in: clip.in ?? 0 }, Math.max(0, frame - clip.start))) / Math.max(1, fps);
}
export function editorPlaybackRate(clip: Clip, frame: number): number {
    return clip.freezeFrame !== undefined ? 0 : Math.max(.1, Math.min(16, speedAt(clip, Math.max(0, frame - clip.start))));
}

/** Schema-3 fades multiply, including their overlap, before the native player's final clamp. */
export function editorClipGain(clip: Clip, frame: number): number {
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    const end = clip.start + clip.len, fadeOutStart = Math.max(clip.start, end - (clip.fadeOut ?? 0));
    const entering = clip.fadeIn ? clamp((frame - clip.start) / clip.fadeIn) : 1;
    const leaving = clip.fadeOut ? clamp((end - frame) / Math.max(1, end - fadeOutStart)) : 1;
    return clamp((clip.volume ?? 1) * entering * leaving);
}
