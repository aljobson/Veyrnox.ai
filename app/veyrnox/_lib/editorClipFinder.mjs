// Clip finder, stage 1 (ADR-0105 slice C). Pure and local: no model, no network, no media API. It ranks short stretches of one source
// clip from three signals the editor can already produce: shot changes, audio loudness and spoken words. Every pick says why.
import { FPS } from './editorTimeline.mjs';
import { addSequenceClip, sequenceEnd } from './editorSequence.mjs';
import { transcriptEntries } from './editorTranscript.mjs';

export const FINDER_DEFAULTS = Object.freeze({
    minSeconds: 3, maxSeconds: 10, targetSeconds: 6, count: 5,
    maxOverlap: 0.25,       // a pick may share at most this much of the shorter one with a better pick
    cutTolerance: 0.12,     // seconds: how near a cut counts as "on" it
    wordsPerSecondCap: 3,   // speech this dense scores full marks
    maxCandidates: 2000,
});
const WEIGHTS = Object.freeze({ energy: 0.3, speech: 0.3, edges: 0.15, single: 0.1, length: 0.15 });

/** Loudness per window: RMS of mono samples. `samples` is any array-like of numbers in -1..1. */
export function energyWindows(samples, sampleRate, windowSeconds = 0.5) {
    const size = Math.max(1, Math.round(sampleRate * windowSeconds)), out = [];
    for (let at = 0; at < samples.length; at += size) {
        const end = Math.min(samples.length, at + size);
        let sum = 0;
        for (let i = at; i < end; i++) sum += samples[i] * samples[i];
        out.push(Math.sqrt(sum / (end - at)));
    }
    return { windowSeconds, values: out };
}

const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

/** Candidate stretches: runs of whole shots that fit the length range, plus windows inside a shot that is longer than the maximum. */
export function candidateSegments(duration, cuts, options = {}) {
    const o = { ...FINDER_DEFAULTS, ...options };
    const edges = [0, ...[...cuts].filter(t => t > 0 && t < duration).sort((a, b) => a - b), duration];
    const out = [], seen = new Set();
    const push = (start, end) => {
        const key = `${start.toFixed(3)}:${end.toFixed(3)}`;
        if (end - start < o.minSeconds - 1e-9 || end - start > o.maxSeconds + 1e-9 || seen.has(key) || out.length >= o.maxCandidates) return;
        seen.add(key); out.push({ start, end });
    };
    for (let i = 0; i < edges.length - 1; i++) {
        if (edges[i + 1] - edges[i] > o.maxSeconds) {
            // One long shot: slide a window of the target length across it.
            const step = Math.max(1, o.targetSeconds / 2), length = Math.min(o.targetSeconds, o.maxSeconds);
            for (let s = edges[i]; s + length <= edges[i + 1] + 1e-9; s += step) push(s, s + length);
            continue;
        }
        for (let j = i + 1; j < edges.length; j++) {
            if (edges[j] - edges[i] > o.maxSeconds) break;
            push(edges[i], edges[j]);
        }
    }
    return out;
}

const overlapOf = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** words: [{ start, end, words }] in source seconds. energy: { windowSeconds, values }. */
export function scoreSegment(segment, { cuts = [], energy = null, speech = [], reference = 0, hasSpeech = false }, options = {}) {
    const o = { ...FINDER_DEFAULTS, ...options }, length = segment.end - segment.start, parts = {}, reasons = [];
    if (energy?.values.length && reference > 0) {
        const w = energy.windowSeconds, from = Math.floor(segment.start / w), to = Math.max(from + 1, Math.ceil(segment.end / w));
        const slice = energy.values.slice(from, to);
        parts.energy = Math.min(1, (slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length)) / reference);
    }
    if (hasSpeech) {
        let words = 0;
        for (const s of speech) {
            const span = s.end - s.start, shared = overlapOf(segment, s);
            if (span > 0 && shared > 0) words += s.words * (shared / span);
        }
        parts.speech = Math.min(1, words / length / o.wordsPerSecondCap);
        parts.words = words;
    }
    const nearCut = t => t <= o.cutTolerance || cuts.some(c => Math.abs(c - t) <= o.cutTolerance);
    const onStart = nearCut(segment.start), onEnd = nearCut(segment.end);
    parts.edges = (onStart ? 0.5 : 0) + (onEnd ? 0.5 : 0);
    const inside = cuts.filter(c => c > segment.start + o.cutTolerance && c < segment.end - o.cutTolerance).length;
    parts.single = Math.max(0, 1 - inside * 0.25);
    parts.length = 1 - Math.min(1, Math.abs(length - o.targetSeconds) / o.targetSeconds);
    let total = 0, weight = 0;
    for (const key of Object.keys(WEIGHTS)) if (parts[key] !== undefined) { total += parts[key] * WEIGHTS[key]; weight += WEIGHTS[key]; }
    const score = weight ? total / weight : 0;
    if (parts.energy >= 0.7) reasons.push('Loud, lively audio');
    if (parts.speech >= 0.5) reasons.push(`Lots of speech (about ${(parts.words / length).toFixed(1)} words a second)`);
    if (parts.edges === 1) reasons.push('Starts and ends on a cut');
    if (inside === 0) reasons.push('One continuous shot'); else if (inside >= 2) reasons.push(`Cuts often (${inside} cuts inside)`);
    if (parts.length >= 0.8) reasons.push('A good length for a short clip');
    return { ...segment, score, parts, reasons: reasons.length ? reasons : ['No standout signal; the best of what is left'] };
}

/** Top picks, best first, with no two picks sharing more than `maxOverlap` of the shorter one. */
export function rankSegments({ duration, cuts = [], energy = null, speech = [] }, userOptions = {}) {
    const o = { ...FINDER_DEFAULTS, ...userOptions };
    if (!(duration >= o.minSeconds)) return [];
    const reference = energy?.values.length ? percentile(energy.values, 0.95) : 0;
    const ctx = { cuts, energy, speech, reference, hasSpeech: speech.some(s => s.words > 0) };
    const scored = candidateSegments(duration, cuts, o).map(seg => scoreSegment(seg, ctx, o))
        .sort((a, b) => b.score - a.score || a.start - b.start);
    const picks = [];
    for (const seg of scored) {
        if (picks.length >= o.count) break;
        const clash = picks.some(p => overlapOf(seg, p) / Math.min(seg.end - seg.start, p.end - p.start) > o.maxOverlap);
        if (!clash) picks.push(seg);
    }
    return picks;
}

/** Spoken words from the clip's captions, as source seconds. Captions are timeline text; the clip says where its source begins. */
export function speechFromCaptions(tl, item) {
    const from = item.start, to = item.start + item.len, out = [];
    for (const e of transcriptEntries(tl)) {
        if (e.start + e.len <= from || e.start >= to) continue;
        const words = String(e.text || '').trim().split(/\s+/).filter(Boolean).length;
        if (!words) continue;
        out.push({ start: (e.start - from + item.in) / FPS, end: (e.start - from + item.in + e.len) / FPS, words });
    }
    return out;
}

/** Puts the chosen stretches on the timeline one after another, after everything already there. All or nothing. */
export function insertClipSegments(tl, mediaId, segments) {
    if (!Array.isArray(segments) || !segments.length) return { error: 'Choose at least one clip to add.' };
    let next = tl, at = sequenceEnd(tl);
    for (const seg of [...segments].sort((a, b) => a.start - b.start)) {
        const inFrame = Math.round(seg.start * FPS), len = Math.round((seg.end - seg.start) * FPS);
        if (!(len >= 1)) return { error: 'A chosen clip has no length.' };
        next = addSequenceClip(next, 'video', mediaId, { in: inFrame, len, start: at });
        if (next.error) return next;
        at += len;
    }
    return next;
}
