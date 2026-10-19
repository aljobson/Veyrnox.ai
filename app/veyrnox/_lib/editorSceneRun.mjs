import { helperEnglish, helperDiagnostic } from '../../../lib/helperMessages.mjs';
// Scene detection for one timeline clip (ADR-0105 slice B). The pure helpers are tested in node; detectClipScenes() needs a browser
// (Mediabunny decoding) and is measured through scripts/editor-spike/scenes-run.mjs, which runs this same code.
import { FPS } from './editorTimeline.mjs';
import { frameSignature, detectScenes } from './editorSceneDetect.mjs';

// The bounds slice A measured (ADR-0090). Longer or larger input is refused, not attempted.
export const SCENE_BOUNDS = Object.freeze({ maxSeconds: 30, maxPixels: 1280 * 720, sampleWidth: 128, sampleHeight: 72 });

/** Returns an error message when the clip is outside what scene detection was measured on, otherwise null. */
export function checkSceneBounds(media, clip) {
    if (!media || media.kind !== 'video') return helperEnglish('scene_detection_works_on_video_clips');
    if (!clip || !Number.isInteger(clip.len) || clip.len < 3) return helperEnglish('select_a_longer_video_clip_first');
    if (clip.len > SCENE_BOUNDS.maxSeconds * FPS) return helperEnglish('scene_detection_handles_up_to_seconds_at_a', { value1: SCENE_BOUNDS.maxSeconds });
    if ((media.width || 0) * (media.height || 0) > SCENE_BOUNDS.maxPixels) return helperEnglish('scene_detection_handles_up_to_720p_video_for');
    return null;
}

/**
 * Detector cuts are source seconds. A timeline cut is the clip's start plus the distance from where the clip begins in its source.
 * Cuts on the first or last frame of the clip are dropped (they split nothing), and cuts that land on the same frame count once.
 */
export function cutsToTimelineFrames(clip, clipStart, cuts) {
    const frames = new Set();
    for (const cut of cuts) {
        const offset = Math.round(cut.time * FPS) - clip.in;
        if (offset >= 1 && offset <= clip.len - 1) frames.add(clipStart + offset);
    }
    return [...frames].sort((a, b) => a - b);
}

/**
 * The multitrack clip must show its source at normal speed for source time to map straight onto the timeline. Returns a message or null.
 * Bounds are checked on the clip's own length, so a trimmed long source can be analysed.
 */
export function checkSequenceClipForScenes(media, item) {
    if (!item) return 'Select a video clip on the timeline first.';
    if (item.reverse || item.speedCurve || item.freezeFrame !== undefined || (item.rate ?? 1) !== 1) return helperEnglish('reset_speed_reverse_and_freeze_on_this_clip');
    return checkSceneBounds(media, item);
}

/** One row per detected cut: its timeline frame, its source time, and whether it starts ticked (hard cuts only). Cuts that split nothing are dropped. */
export function sceneRows(item, cuts) {
    const rows = [];
    for (const cut of cuts) {
        const [frame] = cutsToTimelineFrames(item, item.start, [cut]);
        if (frame === undefined || rows.some(r => r.frame === frame)) continue;
        rows.push({ frame, time: cut.time, kind: cut.kind === 'hard' ? 'hard' : 'possible', ticked: cut.kind === 'hard' });
    }
    return rows.sort((a, b) => a.frame - b.frame);
}

/** Frames of the rows the user left ticked. "Add all" is the hard cuts only; a possible dissolve is added only if the user ticks it. */
export const tickedFrames = rows => rows.filter(r => r.ticked).map(r => r.frame);

/** Hard cuts are suggested ticked; dissolves are only "possible" and are never part of Add all. */
export function partitionCuts(cuts) {
    return { hard: cuts.filter(c => c.kind === 'hard'), possible: cuts.filter(c => c.kind !== 'hard') };
}

/** Browser only. Decodes the clip's source range in order and returns { cuts: [{ time, score, kind }] } in source seconds. */
export async function detectClipScenes(blob, clip, { signal, onProgress } = {}) {
    const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const { sampleWidth: w, sampleHeight: h } = SCENE_BOUNDS;
    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) return { error: 'This file has no video to analyse.' };
        const from = clip.in / FPS, to = (clip.in + clip.len) / FPS;
        const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill' });
        const scratch = new OffscreenCanvas(w, h), g = scratch.getContext('2d', { willReadFrequently: true });
        const samples = [], total = Math.max(1, clip.len);
        for await (const frame of sink.canvases(from, to)) {
            if (signal?.aborted) throw Object.assign(new Error('Scene detection cancelled.'), { name: 'AbortError' });
            g.drawImage(frame.canvas, 0, 0);
            samples.push({ time: frame.timestamp, signature: frameSignature(g.getImageData(0, 0, w, h).data, w, h) });
            onProgress?.(Math.min(1, samples.length / total));
        }
        return detectScenes(samples);
    } finally { input.dispose?.(); }
}

/** Locale-neutral display diagnostic; the legacy string interface remains available. */
export const checkSequenceClipForScenesDiagnostic = (...args) => helperDiagnostic(checkSequenceClipForScenes(...args));
