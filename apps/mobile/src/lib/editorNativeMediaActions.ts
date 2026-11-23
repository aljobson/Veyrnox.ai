import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { editorDeviceMedia, setEditorMediaOwner } from './editorDeviceMedia';
import { editorMedia } from './editorMedia';
import type { EditorMotionOutput } from './editorMotionProcessingNative';
import { editorPersonMasks, editorVideoPersonMask, type EditorPersonMaskCategory } from './editorPersonMask';
import { discardCacheCopy } from './cacheFiles';
import { extractFrame, preparePhoto } from './liveEdit/media';
import { clipAt, type Clip, type Selection, type Timeline } from './nativeEditorModel';
import { sourceFrame, sourceRange } from '../../../../app/veyrnox/_lib/editorSpeed.mjs';
import { editorSemanticMaskIdentity } from './editorSemanticMaskIdentity';

export type AdoptMotionResult = { readonly ok: true; readonly timeline: Timeline; readonly mediaId: string; readonly uri: string }
    | { readonly ok: false; readonly code: 'stale' | 'copy-failed' | 'commit-refused' | 'invalid-output' };
export type ApplySemanticMaskResult = { readonly ok: true; readonly timeline: Timeline; readonly mediaId: string; readonly uri: string }
    | { readonly ok: false; readonly code: 'cancelled' | 'stale' | 'unsupported-source' | 'capture-failed' | 'inference-failed' | 'copy-failed' | 'commit-refused' };

/** Canonical alpha pre-render bakes every source/timing/visual/audio property. Only composition
 * relationships that require neighbouring layers remain live on the replacement clip. */
export function adoptedMotionClip(clip: Clip, mediaId: string, outputFrames: number): Clip {
    return { id: clip.id, mediaId, start: clip.start, len: Math.min(clip.len, outputFrames), in: 0,
        trackId: clip.trackId, volume: 1, transition: clip.transition ?? 0,
        ...(clip.transitionType ? { transitionType: clip.transitionType } : {}),
        ...(clip.groupId ? { groupId: clip.groupId } : {}), ...(clip.blend ? { blend: clip.blend } : {}) };
}

/**
 * Copies a native S12 result into account-owned project storage, commits the selected clip swap as
 * one editor history mutation, and rolls the copy back if that mutation is refused or stale.
 */
export async function adoptEditorMotionOutput(request: {
    readonly account: string; readonly project: string; readonly timeline: Timeline; readonly selection: Selection;
    readonly output: EditorMotionOutput; readonly live?: () => boolean; readonly commit: (timeline: Timeline) => boolean;
}): Promise<AdoptMotionResult> {
    const { account, project, timeline, selection, output } = request;
    const live = request.live ?? (() => true), selected = clipAt(timeline, selection);
    try {
        if (selection.track !== 'video' || !selected || !('mediaId' in selected) || !selected.mediaId || !live()
            || !output.uri.startsWith('file:') || !Number.isFinite(output.durationSeconds) || output.durationSeconds <= 0
            || !Number.isSafeInteger(output.width) || !Number.isSafeInteger(output.height)) return { ok: false, code: 'invalid-output' };
        await setEditorMediaOwner(account);
        if (!live()) return { ok: false, code: 'stale' };
        const mediaId = `l-${randomUUID()}`;
        const file = await editorDeviceMedia.copy(project, mediaId, output.uri,
            output.videoCodec === 'hvc1-alpha' ? 'video/quicktime' : 'video/mp4', output.durationSeconds, { live });
        if (!file) return { ok: false, code: live() ? 'copy-failed' : 'stale' };
        if (!live()) { await editorDeviceMedia.remove(project, mediaId); return { ok: false, code: 'stale' }; }
        const previous = timeline.media[selected.mediaId];
        if (!previous) { await editorDeviceMedia.remove(project, mediaId); return { ok: false, code: 'invalid-output' }; }
        const outputFrames = Math.max(1, Math.round(output.durationSeconds * timeline.fps));
        const replacement = adoptedMotionClip(selected, mediaId, outputFrames), bounds = sourceRange(replacement);
        if (bounds.from < 0 || bounds.to >= outputFrames) {
            await editorDeviceMedia.remove(project, mediaId); return { ok: false, code: 'invalid-output' };
        }
        const next: Timeline = { ...timeline, seq: timeline.seq + 1,
            media: { ...timeline.media, [mediaId]: { ...previous, id: mediaId, name: previous.name?.trim() || 'Processed video', kind: 'video', frames: outputFrames,
                hasAudio: output.audioCodec === 'mp4a', width: output.width, height: output.height } },
            video: timeline.video.map(clip => clip.id === selected.id ? replacement : clip) };
        if (!request.commit(next)) { await editorDeviceMedia.remove(project, mediaId); return { ok: false, code: 'commit-refused' }; }
        return { ok: true, timeline: next, mediaId, uri: file.file };
    } finally {
        await editorMedia.release(project, output.artifactId).catch(() => undefined);
    }
}

/** Static semantic masks are exact for image clips and explicitly frozen video frames. Moving
 * video is rejected until a time-indexed mask asset contract is available. */
export function semanticMaskSourceFrame(timeline: Timeline, selection: Selection): number | null {
    const clip = clipAt(timeline, selection);
    if (selection.track !== 'video' || !clip || !('mediaId' in clip) || !clip.mediaId) return null;
    const media = timeline.media[clip.mediaId];
    if (!media || media.kind === 'video' && clip.freezeFrame === undefined || !['image', 'graphic', 'video'].includes(String(media.kind))) return null;
    const frame = sourceFrame(clip, 0);
    return Number.isFinite(frame) && frame >= 0 ? frame : null;
}

export function timelineWithSemanticMask(timeline: Timeline, selection: Selection, mediaId: string,
    category: EditorPersonMaskCategory, source: number, width: number, height: number,
    dynamic?: { fps: 24 | 25 | 30 | 50 | 60; frames: number; identity?: string }): Timeline | null {
    const selected = clipAt(timeline, selection);
    if (selection.track !== 'video' || !selected || !('mediaId' in selected) || !selected.mediaId) return null;
    return { ...timeline, seq: timeline.seq + 1,
        media: { ...timeline.media, [mediaId]: { id: mediaId, name: `${category} mask`, kind: dynamic ? 'video' : 'image', frames: dynamic?.frames ?? 1, hasAudio: false, width, height } },
        video: timeline.video.map(clip => clip.id === selected.id ? { ...clip,
            semanticMask: { version: 1 as const, mediaId, category, sourceFrame: source, ...(dynamic ? { dynamic: {
                fps: dynamic.fps, frames: dynamic.frames, identity: dynamic.identity ?? editorSemanticMaskIdentity(clip),
            } } : {}) } } : clip) };
}

/** Capture, infer, durably persist, and apply one semantic mask as a single undoable edit. */
export async function captureAndApplyEditorSemanticMask(request: {
    readonly account: string; readonly project: string; readonly timeline: Timeline; readonly selection: Selection;
    readonly sourceUri: string; readonly category: EditorPersonMaskCategory; readonly commit: (timeline: Timeline) => boolean;
    readonly live?: () => boolean; readonly signal?: AbortSignal;
}): Promise<ApplySemanticMaskResult> {
    const live = request.live ?? (() => true);
    if (!request.sourceUri.startsWith('file:')) return { ok: false, code: 'unsupported-source' };
    const clip = clipAt(request.timeline, request.selection), media = clip && 'mediaId' in clip && clip.mediaId ? request.timeline.media[clip.mediaId] : null;
    if (!clip || !media || request.selection.track !== 'video') return { ok: false, code: 'unsupported-source' };
    const staticSource = semanticMaskSourceFrame(request.timeline, request.selection), moving = media.kind === 'video' && clip.freezeFrame === undefined;
    const firstSource = sourceFrame(clip, 0);
    if (!Number.isFinite(firstSource) || firstSource < 0 || (!moving && staticSource === null)) return { ok: false, code: 'unsupported-source' };
    const abort = request.signal ?? new AbortController().signal;
    let extracted: string | null = null, prepared: Awaited<ReturnType<typeof preparePhoto>> | null = null, temporary: File | null = null;
    let nativeMaskUri: string | null = null;
    let durableMediaId: string | null = null;
    try {
        if (abort.aborted || !live()) return { ok: false, code: abort.aborted ? 'cancelled' : 'stale' };
        let maskUri: string, maskWidth: number, maskHeight: number, maskType: 'image/png' | 'video/mp4';
        let dynamic: { fps: 24 | 25 | 30 | 50 | 60; frames: number; identity: string } | undefined;
        if (moving) {
            if (![24, 25, 30, 50, 60].includes(request.timeline.fps)) return { ok: false, code: 'unsupported-source' };
            const fps = request.timeline.fps as 24 | 25 | 30 | 50 | 60;
            const times = Array.from({ length: clip.len }, (_, offset) => sourceFrame(clip, offset) / fps);
            if (times.length > 1_800 || times.some(time => !Number.isFinite(time) || time < 0 || time > 10_000_000 / 30)) return { ok: false, code: 'unsupported-source' };
            await editorMedia.setOwner(request.account);
            const generation = editorMedia.projectGeneration(request.project);
            if (generation === null) return { ok: false, code: 'stale' };
            const inferred = await editorVideoPersonMask(request.account, request.project, generation, request.sourceUri, times, fps, request.category, abort);
            if (!inferred.ok) return { ok: false, code: inferred.code === 'cancelled' ? 'cancelled' : 'inference-failed' };
            if (editorMedia.projectGeneration(request.project) !== generation || !live()) return { ok: false, code: 'stale' };
            nativeMaskUri = inferred.uri; maskUri = inferred.uri; maskWidth = inferred.width; maskHeight = inferred.height; maskType = 'video/mp4';
            dynamic = { fps, frames: inferred.frames, identity: editorSemanticMaskIdentity(clip) };
        } else {
            try {
                extracted = media.kind === 'video' ? await extractFrame(request.sourceUri, staticSource! / request.timeline.fps, abort, 30) : request.sourceUri;
                prepared = await preparePhoto(extracted, { sourceId: 0, frameId: Math.round(staticSource!) });
            } catch { return { ok: false, code: abort.aborted ? 'cancelled' : 'capture-failed' }; }
            if (abort.aborted || !live()) return { ok: false, code: abort.aborted ? 'cancelled' : 'stale' };
            const inferred = await editorPersonMasks(prepared.frame.jpeg, prepared.frame.width, prepared.frame.height, abort);
            if (!inferred.ok) return { ok: false, code: inferred.code === 'cancelled' ? 'cancelled' : 'inference-failed' };
            temporary = new File(Paths.cache, `vx-semantic-mask-${randomUUID()}.png`);
            temporary.create({ overwrite: true }); temporary.write(inferred.pngs[request.category]);
            maskUri = temporary.uri; maskWidth = inferred.width; maskHeight = inferred.height; maskType = 'image/png';
        }
        if (!live()) return { ok: false, code: 'stale' };
        await setEditorMediaOwner(request.account);
        if (!live()) return { ok: false, code: 'stale' };
        durableMediaId = `l-${randomUUID()}`;
        const stored = await editorDeviceMedia.copy(request.project, durableMediaId, maskUri, maskType,
            dynamic ? dynamic.frames / dynamic.fps : undefined, { live });
        if (!stored) return { ok: false, code: live() ? 'copy-failed' : 'stale' };
        const next = timelineWithSemanticMask(request.timeline, request.selection, durableMediaId, request.category, firstSource,
            maskWidth, maskHeight, dynamic);
        if (!next || !live()) { await editorDeviceMedia.remove(request.project, durableMediaId); return { ok: false, code: 'stale' }; }
        if (!request.commit(next)) { await editorDeviceMedia.remove(request.project, durableMediaId); return { ok: false, code: 'commit-refused' }; }
        return { ok: true, timeline: next, mediaId: durableMediaId, uri: stored.file };
    } finally {
        if (temporary?.exists) { try { temporary.delete(); } catch {} }
        if (nativeMaskUri) { try { const file = new File(nativeMaskUri); if (file.exists) file.delete(); } catch {} }
        if (prepared) discardCacheCopy(prepared.uri);
        if (extracted && extracted !== request.sourceUri) discardCacheCopy(extracted);
    }
}

export function timelineWithoutSemanticMask(timeline: Timeline, selection: Selection): { timeline: Timeline; mediaId: string } | null {
    const selected = clipAt(timeline, selection);
    if (selection.track !== 'video' || !selected || !('semanticMask' in selected) || !selected.semanticMask) return null;
    const selectedClip = selected as Clip;
    const mediaId = selectedClip.semanticMask!.mediaId;
    const video = timeline.video.map(clip => {
        if (clip.id !== selectedClip.id) return clip;
        const { semanticMask: _semanticMask, ...rest } = clip; return rest;
    });
    const stillUsed = video.some(clip => (clip as Clip).semanticMask?.mediaId === mediaId);
    const { [mediaId]: _removed, ...remainingMedia } = timeline.media;
    return { timeline: { ...timeline, seq: timeline.seq + 1, video, media: stillUsed ? timeline.media : remainingMedia }, mediaId };
}

export async function removeEditorSemanticMask(request: { readonly project: string; readonly timeline: Timeline; readonly selection: Selection;
    readonly commit: (timeline: Timeline) => boolean }): Promise<{ readonly ok: true; readonly timeline: Timeline; readonly mediaId: string } | { readonly ok: false; readonly code: 'invalid-output' | 'commit-refused' }> {
    const next = timelineWithoutSemanticMask(request.timeline, request.selection);
    if (!next) return { ok: false, code: 'invalid-output' };
    if (!request.commit(next.timeline)) return { ok: false, code: 'commit-refused' };
    // Keep durable mask media until project cleanup so one-step editor undo can restore it.
    return { ok: true, ...next };
}
