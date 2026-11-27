import type { BestCutClip } from './bestCutFlow';
import type { DeviceFile } from './editorDeviceMedia';
import type { Timeline } from './nativeEditorModel';

/**
 * Converts the current editor project into Best Cut inputs in visual order.
 * A source used by several timeline clips is analysed once; the accepted plan
 * can still select multiple ranges from that source.
 */
export function bestCutProjectClips(timeline: Timeline, files: Readonly<Record<string, DeviceFile>>): BestCutClip[] {
    const seen = new Set<string>();
    const result: BestCutClip[] = [];
    const ordered = [...timeline.video].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (const clip of ordered) {
        const id = clip.mediaId;
        if (!id || seen.has(id)) continue;
        const media = timeline.media[id];
        if (!media || (media.kind && media.kind !== 'video')) continue;
        const frames = Math.max(media.frames ?? 0, (clip.in ?? 0) + clip.len);
        const duration = frames / Math.max(1, timeline.fps);
        if (!Number.isFinite(duration) || duration <= 0) continue;
        const file = files[id];
        const source = id.startsWith('j-') ? { type: 'job' as const, jobId: id.slice(2) } : undefined;
        if (!file && !source) continue;
        seen.add(id);
        result.push({ media, duration, ...(file ? { file } : {}), ...(source ? { source } : {}) });
        if (result.length === 10) break;
    }
    return result;
}
