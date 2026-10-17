// Clip finder, stage 1, in the browser (ADR-0105 slice C). Decodes the clip's audio for loudness, finds its shot changes with the slice A
// detector, reads speech from captions and ranks. Everything runs on this device: no upload, no model, no credits.
import { FPS } from './editorTimeline.mjs';
import { SCENE_BOUNDS, checkSequenceClipForScenes, detectClipScenes } from './editorSceneRun.mjs';
import { createEnergyAccumulator, rankSegments, speechFromCaptions } from './editorClipFinder.mjs';

export const CLIP_ENERGY_WINDOW_SECONDS = 0.5;

/** Same limits as scene detection: the clip finder starts by finding shots. Returns a message or null. */
export const checkClipForFinder = (media, item) => checkSequenceClipForScenes(media, item);

/** Browser only. Loudness per half second over the clip's source range, or null when the file has no audio. */
export async function measureClipLoudness(blob, clip, { signal } = {}) {
    const { Input, BlobSource, ALL_FORMATS, AudioBufferSink } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
        const track = await input.getPrimaryAudioTrack();
        if (!track) return null;
        const from = clip.in / FPS, to = (clip.in + clip.len) / FPS;
        const acc = createEnergyAccumulator(CLIP_ENERGY_WINDOW_SECONDS, from, to);
        for await (const part of new AudioBufferSink(track).buffers(from, to)) {
            if (signal?.aborted) throw Object.assign(new Error('Clip search cancelled.'), { name: 'AbortError' });
            acc.add(part.timestamp, part.buffer.sampleRate, Array.from({ length: part.buffer.numberOfChannels }, (_, c) => part.buffer.getChannelData(c)));
        }
        return acc.result();
    } finally { input.dispose?.(); }
}

/**
 * Best stretches of one timeline clip, in SOURCE seconds (what insertClipSegments takes). `tl` supplies captions for speech; `item` is the
 * clip on the sequence. Returns { picks } or { error }.
 */
export async function findClips(blob, tl, item, { signal, options, onProgress } = {}) {
    const from = item.in / FPS, duration = item.len / FPS;
    const [scenes, energy] = await Promise.all([detectClipScenes(blob, item, { signal, onProgress }), measureClipLoudness(blob, item, { signal })]);
    if (scenes.error) return scenes;
    const cuts = scenes.cuts.filter(c => c.kind === 'hard').map(c => c.time - from).filter(t => t > 0 && t < duration);
    const speech = speechFromCaptions(tl, item).map(s => ({ ...s, start: s.start - from, end: s.end - from }));
    const picks = rankSegments({ duration, cuts, energy, speech }, options).map(p => ({ ...p, start: p.start + from, end: p.end + from }));
    return { picks, hadAudio: !!energy, cutCount: cuts.length, boundsSeconds: SCENE_BOUNDS.maxSeconds };
}

/**
 * One row per pick for the panel: where it starts on the timeline (to seek and to mark the ruler), how long it is, why it was picked, and
 * whether it starts ticked (the best three). Picks that fall outside the clip's source range are dropped.
 */
export function pickRows(item, picks, tickedCount = 3) {
    const rows = [];
    for (const pick of picks) {
        const startFrame = Math.round(pick.start * FPS), endFrame = Math.round(pick.end * FPS);
        if (startFrame < item.in || endFrame > item.in + item.len || endFrame <= startFrame) continue;
        rows.push({ start: pick.start, end: pick.end, frame: item.start + startFrame - item.in, seconds: pick.end - pick.start, reasons: pick.reasons, ticked: rows.length < tickedCount });
    }
    return rows;
}

/** The ticked rows, as the { start, end } pairs insertClipSegments takes. */
export const tickedPicks = rows => rows.filter(r => r.ticked).map(({ start, end }) => ({ start, end }));
