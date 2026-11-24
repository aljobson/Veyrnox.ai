import { type Timeline, type Selection, type Clip, framesIn } from './nativeEditorModel';
export type SpeechChunk = { start: number; end: number; text: string };
export type SpeechAnalysis = { version: 1; assetId: string; duration: number; provider: 'fal-scribe-v2' | 'fal-wizper'; transcript: string; language: string; timingQuality?: 'word' | 'phrase'; chunks: SpeechChunk[] };
export type SilencePreset = 'snappy' | 'natural' | 'relaxed';
/** Same presets as web SMART_CUT_SILENCE_PRESETS; `balanced` is the demo planner's name for `natural`. */
export const SILENCE_PRESETS: Record<SilencePreset, { minimumSeconds: number; edgePaddingSeconds: number }> = {
    snappy: { minimumSeconds: .4, edgePaddingSeconds: .08 }, natural: { minimumSeconds: .75, edgePaddingSeconds: .12 }, relaxed: { minimumSeconds: 1.2, edgePaddingSeconds: .18 } };
export const silencePreset = (name?: string): SilencePreset => { const key = name === 'balanced' ? 'natural' : name; return key === 'snappy' || key === 'relaxed' ? key : 'natural'; };
export type SpeechRange = { start: number; end: number; label: string };
export type SpeechRangeWarning = { code: 'trim_intersects_unit' | 'segment_limit_reached' | 'output_limit_reached'; parameters: Readonly<Record<string, unknown>> };
export type SpeechRangePlan = { ranges: SpeechRange[]; warningDetails: SpeechRangeWarning[] };
export type SilenceRemovalProposalPlan = SpeechRangePlan & { removals: SpeechRange[]; checked: boolean[] };
export type SpeechMode = 'silences' | 'retakes' | 'fillers';
export class SpeechCutPlanError extends Error {
    constructor(readonly code: 'trim_intersects_unit' | 'unit_exceeds_budget', message: string, readonly parameters: Readonly<Record<string, unknown>> = {}) {
        super(message); this.name = 'SpeechCutPlanError';
    }
}
const languages = ['en', 'es', 'zh', 'hi', 'ar', 'fr', 'pt', 'ru', 'ja', 'de', 'ko'];
const iso3: Record<string, string> = { eng: 'en', spa: 'es', zho: 'zh', cmn: 'zh', chi: 'zh', hin: 'hi', ara: 'ar', fra: 'fr', fre: 'fr', por: 'pt', rus: 'ru', jpn: 'ja', deu: 'de', ger: 'de', kor: 'ko' };
const clean = (v: unknown) => String(v || '').replace(/\s+/g, ' ').trim();
const round = (n: number) => Math.round(n * 100) / 100;
const ceil = (n: number) => Math.max(0, Math.ceil(n * 100 - 1e-9) / 100);
const floor = (n: number) => Math.floor(n * 100) / 100;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** TypeScript port of smartCutAnalysis.js; provider extras are discarded at the boundary. */
export function parseSmartCutAnalysis(v: unknown, expected: { assetId?: string; duration?: number } = {}): { ok: true; analysis: SpeechAnalysis } | { ok: false; error: string } {
    const bad = (error: string) => ({ ok: false as const, error });
    if (!object(v)) return bad('analysis_invalid');
    if (v.version !== 1) return bad('analysis_version_unsupported');
    if (typeof v.assetId !== 'string' || !v.assetId || (expected.assetId && v.assetId !== expected.assetId)) return bad('analysis_asset_mismatch');
    if (!finite(v.duration) || v.duration <= 0 || (finite(expected.duration) && Math.abs(v.duration - expected.duration) > .1)) return bad('analysis_duration_mismatch');
    if (!['fal-scribe-v2', 'fal-wizper'].includes(String(v.provider))) return bad('analysis_provider_invalid');
    if (typeof v.transcript !== 'string' || v.transcript.length > 100000) return bad('analysis_transcript_invalid');
    if (v.language != null && (typeof v.language !== 'string' || v.language.length > 32)) return bad('analysis_language_invalid');
    if (!Array.isArray(v.chunks) || !v.chunks.length || v.chunks.length > 10000) return bad('analysis_chunks_invalid');
    const chunks: SpeechChunk[] = [];
    for (const c of v.chunks) {
        if (!object(c)) return bad('analysis_chunk_invalid');
        if (!finite(c.start) || !finite(c.end) || c.start < 0 || c.end <= c.start || c.end > v.duration + .05) return bad('analysis_timestamp_invalid');
        const text = clean(c.text); if (!text || text.length > 1000) return bad('analysis_chunk_text_invalid');
        chunks.push({ start: round(c.start), end: round(Math.min(v.duration, c.end)), text });
    }
    const code = typeof v.language === 'string' ? v.language.toLowerCase() : '';
    return { ok: true, analysis: { version: 1, assetId: v.assetId, duration: round(v.duration), provider: v.provider as SpeechAnalysis['provider'],
        transcript: clean(v.transcript), language: languages.includes(code) ? code : iso3[code] || 'und', timingQuality: v.provider === 'fal-wizper' ? 'phrase' : 'word', chunks: chunks.sort((a, b) => a.start - b.start || a.end - b.end) } };
}
/** Same complete-unit, padded, overlap-merged ranges as the web and Smart Cut planners. */
export function silenceRangePlan(analysis: SpeechAnalysis, start = 0, end = analysis.duration, preset: SilencePreset | 'balanced' = 'natural', maxOutputSeconds = 60): SpeechRangePlan {
    const { minimumSeconds, edgePaddingSeconds } = SILENCE_PRESETS[silencePreset(preset)];
    type Group = SpeechRange & { entries: SpeechChunk[] };
    const overlapping = analysis.chunks.filter((chunk) => chunk.end > start && chunk.start < end);
    const intersections = overlapping.filter((chunk) => chunk.start < start || chunk.end > end);
    const entries = overlapping.filter((chunk) => chunk.start >= start && chunk.end <= end);
    if (!entries.length && intersections.length) throw new SpeechCutPlanError('trim_intersects_unit', 'No complete timed speech unit fits inside the selected clip range.', {
        reason: 'trim_intersects_all_units', units: intersections,
    });
    const groups: Group[] = [];
    for (const entry of entries) {
        const last = groups.at(-1);
        if (!last || entry.start - last.end >= minimumSeconds) groups.push({ start: entry.start, end: entry.end, label: entry.text, entries: [entry] });
        else { last.end = Math.max(last.end, entry.end); last.label += ` ${entry.text}`; last.entries.push(entry); }
    }
    const leadingBarrier = intersections.filter((unit) => unit.start < start && unit.end > start).reduce((bound, unit) => Math.max(bound, unit.end), start);
    const trailingBarrier = intersections.filter((unit) => unit.start < end && unit.end > end).reduce((bound, unit) => Math.min(bound, unit.start), end);
    const merged: Group[] = [];
    for (const group of groups) {
        const padded = { ...group, entries: [...group.entries], start: Math.min(trailingBarrier, Math.max(leadingBarrier, ceil(group.start - edgePaddingSeconds))), end: Math.min(floor(trailingBarrier), floor(group.end + edgePaddingSeconds)) };
        const last = merged.at(-1);
        if (last && padded.start <= last.end) { last.end = Math.max(last.end, padded.end); last.label += ` ${padded.label}`; last.entries.push(...padded.entries); }
        else merged.push(padded);
    }
    const beforeMerge = merged.length;
    while (merged.length > 10) {
        let index = 0, smallest = Infinity;
        for (let i = 0; i < merged.length - 1; i++) if (merged[i + 1].start - merged[i].end < smallest) { index = i; smallest = merged[i + 1].start - merged[i].end; }
        merged.splice(index, 2, { start: merged[index].start, end: merged[index + 1].end, label: `${merged[index].label} ${merged[index + 1].label}`, entries: [...merged[index].entries, ...merged[index + 1].entries] });
    }
    const ranges: SpeechRange[] = [], warningDetails: SpeechRangeWarning[] = [];
    if (intersections.length) warningDetails.push({ code: 'trim_intersects_unit', parameters: { count: intersections.length, units: intersections } });
    if (beforeMerge > merged.length) warningDetails.push({ code: 'segment_limit_reached', parameters: { mergedGroups: beforeMerge - merged.length, omittedGroups: 0, omitted: [] } });
    let offset = 0;
    for (const [index, group] of merged.entries()) {
        const remaining = maxOutputSeconds - offset;
        if (remaining <= .01) { warningDetails.push({ code: 'output_limit_reached', parameters: { count: merged.length - index } }); break; }
        const maximumEnd = group.start + remaining;
        const complete = group.entries.filter((entry) => entry.end <= maximumEnd + 1e-9).at(-1);
        const rangeEnd = group.end <= maximumEnd + 1e-9 ? group.end
            : complete ? Math.min(group.end, maximumEnd, ceil(complete.end)) : undefined;
        if (rangeEnd == null || rangeEnd <= group.start) {
            if (!ranges.length) throw new SpeechCutPlanError('unit_exceeds_budget', 'The first complete timed speech unit is longer than the output budget.', {
                start: group.entries[0]?.start ?? group.start, end: group.entries[0]?.end ?? group.end,
            });
            warningDetails.push({ code: 'output_limit_reached', parameters: { count: merged.length - index } });
            break;
        }
        const rangeStart = ceil(group.start);
        if (rangeEnd <= rangeStart) continue;
        const label = clean(group.entries.filter((entry) => entry.start < rangeEnd).map((entry) => entry.text).join(' '));
        ranges.push({ start: rangeStart, end: rangeEnd, label: label.length > 120 ? `${label.slice(0, 117).trimEnd()}…` : label });
        offset = round(offset + round(rangeEnd - rangeStart));
        if (rangeEnd < group.end - .01) {
            if (group.entries.some((entry) => entry.end > rangeEnd) || index < merged.length - 1) warningDetails.push({ code: 'output_limit_reached', parameters: { count: merged.length - index } });
            break;
        }
    }
    return { ranges, warningDetails };
}
export function silenceRanges(analysis: SpeechAnalysis, start = 0, end = analysis.duration, preset: SilencePreset | 'balanced' = 'natural'): SpeechRange[] {
    return silenceRangePlan(analysis, start, end, preset).ranges;
}

/**
 * Build in-place editor proposals without applying Smart Cut's separate 60-second
 * output budget. Any gap that contains a trim-boundary word stays unchecked so a
 * suggestion can never silently delete timed speech.
 */
export function silenceRemovalProposalPlan(analysis: SpeechAnalysis, start = 0, end = analysis.duration, preset: SilencePreset | 'balanced' = 'natural'): SilenceRemovalProposalPlan {
    const plan = silenceRangePlan(analysis, start, end, preset, Math.max(0.01, end - start));
    const removals = keptAfterRemovals(plan.ranges, start, end);
    const unsafeUnits = plan.warningDetails
        .filter((warning) => warning.code === 'trim_intersects_unit')
        .flatMap((warning) => Array.isArray(warning.parameters.units) ? warning.parameters.units : [])
        .filter((unit): unit is SpeechChunk => object(unit) && finite(unit.start) && finite(unit.end));
    const checked = removals.map((range) => !unsafeUnits.some((unit) => unit.end > range.start && unit.start < range.end));
    return { ...plan, removals, checked };
}
function tokens(text: string, language: string) {
    const normalized = text.normalize('NFKC').toLocaleLowerCase(language).replace(/[^\p{L}\p{N}\s]/gu, '').trim();
    return ['zh', 'ja'].includes(language) || (language === 'ko' && !/\s/u.test(normalized)) ? Array.from(normalized.replace(/\s/gu, '')) : normalized.split(/\s+/u).filter(Boolean);
}
/** Advisory proposals only: the earlier utterance is removed only while its checkbox stays selected. */
export function retakeRanges(analysis: SpeechAnalysis): SpeechRange[] {
    if (analysis.language === 'und') return [];
    const utterances: SpeechRange[] = [];
    for (const word of analysis.chunks) {
        const previous = utterances.at(-1);
        if (!previous || word.start - previous.end >= .45 || /[.!?。！？]$/u.test(previous.label.trim())) utterances.push({ start: word.start, end: word.end, label: word.text });
        else { previous.end = Math.max(previous.end, word.end); previous.label += ` ${word.text}`; }
    }
    const result: SpeechRange[] = [];
    for (let i = 0; i < utterances.length; i++) {
        const earlier = utterances[i], a = tokens(earlier.label, analysis.language);
        if (a.length < 4) continue;
        for (let j = i + 1; j < utterances.length; j++) {
            const later = utterances[j], b = tokens(later.label, analysis.language);
            if (later.start - earlier.end > 8) break;
            if (later.start < earlier.end || b.length < 4) continue;
            let prefix = 0; while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
            // Ordered longest common subsequence; repeated tokens count only as often as present.
            let row = Array<number>(b.length + 1).fill(0);
            for (const token of a) {
                const next = [0]; for (let k = 0; k < b.length; k++) next.push(token === b[k] ? row[k] + 1 : Math.max(row[k + 1], next[k])); row = next;
            }
            if ((prefix >= 4 && prefix === a.length && a.length < b.length) || row[b.length] / Math.max(a.length, b.length) >= .8) {
                result.push({ ...earlier, start: Math.max(0, floor(earlier.start - .12)), end: Math.min(analysis.duration, ceil(earlier.end + .12), later.start) }); break;
            }
        }
    }
    return result;
}
export function keptAfterRemovals(removals: SpeechRange[], start: number, end: number): SpeechRange[] {
    let cursor = start; const kept: SpeechRange[] = [];
    for (const r of [...removals].sort((a, b) => a.start - b.start)) {
        if (r.end <= cursor || r.start >= end) continue;
        if (r.start > cursor) kept.push({ start: cursor, end: Math.min(r.start, end), label: '' });
        cursor = Math.max(cursor, Math.min(end, r.end));
    }
    if (cursor < end) kept.push({ start: cursor, end, label: '' });
    return kept;
}
export function speechClip(timeline: Timeline, selection: Selection | null): { clip: Clip; track: 'video' | 'audio' } | null {
    if (selection && selection.track !== 'text') {
        const clip = timeline[selection.track].find(c => c.id === selection.id);
        if (clip) return { clip, track: selection.track };
    }
    return timeline.video[0] ? { clip: timeline.video[0], track: 'video' } : null;
}
/** Produce one immutable timeline; the editor records it as one history entry. */
export function applySpeechRanges(timeline: Timeline, target: { clip: Clip; track: 'video' | 'audio' }, kept: SpeechRange[]): Timeline | null {
    const original = timeline[target.track].find(c => c.id === target.clip.id);
    if (!original || timeline.tracks.some(t => t.id === original.trackId && t.locked) || !kept.length || kept.length > 10) return null;
    const rate = original.rate || 1, sourceStart = (original.in || 0) / timeline.fps, sourceEnd = sourceStart + original.len * rate / timeline.fps;
    let cursor = original.start, seq = timeline.seq;
    const bounded = kept.map(r => ({ start: Math.max(sourceStart, r.start), end: Math.min(sourceEnd, r.end) })).filter(r => r.end > r.start);
    if (original.reverse) bounded.reverse();
    const clips = bounded.flatMap(r => {
        const from = Math.ceil(r.start * timeline.fps - 1e-7), to = Math.floor(r.end * timeline.fps + 1e-7), len = Math.floor((to - from) / rate);
        if (len < 1) return [];
        const clip = { ...original, id: `${target.track[0]}${++seq}`, in: from, start: cursor, len, transition: 0 }; cursor += len; return [clip];
    });
    if (!clips.length) return null;
    const removed = original.start + original.len - cursor;
    const next: Timeline = { ...timeline, seq, [target.track]: timeline[target.track].flatMap(c => c.id === original.id ? clips : [{ ...c,
        start: c.trackId === original.trackId && c.start >= original.start + original.len ? c.start - removed : c.start }]) };
    return next.video.length + next.audio.length <= 10 && framesIn(next) <= 60 * timeline.fps ? next : null;
}
