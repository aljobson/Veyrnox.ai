import { parseSmartCutAnalysis, type SpeechAnalysis } from './speechCut';
import { buildSpeechAwareCutPlan as buildCanonicalSpeechAwareCutPlan, swapSpeechAwareCutTake } from '../../../../app/veyrnox/_lib/smartCutAnalysis.js';

export const SMART_CUT_MAX_SEGMENTS = 10;

export const SMART_CUT_PACING = Object.freeze({
    snappy: { labelKey: 'app.smartCut.pacing.snappy', seconds: 3.2 },
    balanced: { labelKey: 'app.smartCut.pacing.balanced', seconds: 4.8 },
    relaxed: { labelKey: 'app.smartCut.pacing.relaxed', seconds: 6.5 },
});

export type SmartCutPacing = keyof typeof SMART_CUT_PACING;
export interface SmartCutSource {
    readonly id: string;
    readonly assetId: string;
    readonly name: string;
    readonly duration: number;
    readonly rangeStart?: number;
    readonly rangeEnd?: number;
}
export type SmartCutTake = Required<SmartCutSource>;
export interface SmartCutBoundaryQuality {
    readonly timingQuality: 'word' | 'phrase' | 'unknown';
    readonly startInsideUnit: boolean;
    readonly endInsideUnit: boolean;
}
export interface SmartCutSegment {
    readonly id: string;
    readonly label: string;
    readonly takeId: string;
    readonly start: number;
    readonly end: number;
    readonly outputOffset: number;
    readonly plannedLength: number;
    readonly boundaryQuality?: SmartCutBoundaryQuality;
    readonly matchStatus: string;
    readonly alternates: readonly string[];
    readonly reason: string;
    readonly matchCode?: 'script_line_matched' | 'transcript_section_kept';
    readonly matchParameters?: Readonly<Record<string, unknown>>;
    readonly reasonCode?: 'best_take_score' | 'transcript_continuity' | 'manual_take';
    readonly reasonParameters?: Readonly<Record<string, unknown>>;
    readonly alternateCandidates?: readonly { readonly takeId: string; readonly start: number; readonly end: number; readonly confidence: number; readonly coverage: number; readonly precision: number; readonly boundaryQuality?: SmartCutBoundaryQuality }[];
}
export interface SmartCutWarning {
    readonly code: 'review_boundaries' | 'trim_intersects_unit' | 'segment_limit_reached' | 'output_limit_reached' | 'unit_exceeds_budget' | 'phrase_timing' | 'removal_retained' | 'source_clip_limit_reached' | 'script_not_aligned' | 'script_incomplete' | 'extra_speech_omitted' | 'false_start_omitted' | 'retake_omitted' | 'join_review' | 'language_unknown' | 'language_mixed' | 'language_override_invalid' | 'script_match_missing' | 'alignment_budget_exceeded';
    readonly parameters: Readonly<Record<string, unknown>>;
}
export interface SmartCutPlan {
    readonly mode: 'local-demo' | 'transcript-silence';
    readonly pacing: SmartCutPacing | 'speech';
    readonly pacingLabel: string;
    readonly notes: string;
    readonly scriptProvided: boolean;
    readonly language?: string;
    readonly languageOverride?: string | null;
    readonly detectedLanguages?: readonly string[];
    readonly takes: readonly SmartCutTake[];
    readonly segments: readonly SmartCutSegment[];
    readonly totalDuration: number;
    readonly warnings: readonly string[];
    readonly warningDetails?: readonly SmartCutWarning[];
    readonly silencePreset?: 'snappy' | 'natural' | 'relaxed';
    readonly silenceRemoved?: number;
    readonly removalsApplied?: number;
    readonly analysisProviders?: readonly SpeechAnalysis['provider'][];
    readonly qualityChecks?: readonly { readonly code: 'complete_unit_boundaries' | 'clipped_timed_unit' | 'phrase_timing_review' | 'source_ranges_non_overlapping' | 'source_overlap' | 'join_review'; readonly parameters: Readonly<Record<string, unknown>> }[];
}

export interface SmartCutRemoval { readonly takeId: string; readonly start: number; readonly end: number }
type SpeechAnalyses = ReadonlyMap<string, SpeechAnalysis> | readonly SpeechAnalysis[] | Readonly<Record<string, SpeechAnalysis>>;
type SpeechEntry = { readonly start: number; readonly end: number; readonly text: string };
type SpeechGroup = { readonly takeId: string; start: number; end: number; entries: SpeechEntry[] };
type TrimIntersection = SpeechEntry & { readonly takeId: string };

export class SmartCutPlanError extends Error {
    readonly code: SmartCutWarning['code'];
    readonly parameters: Readonly<Record<string, unknown>>;

    constructor(code: SmartCutWarning['code'], message: string, parameters: Readonly<Record<string, unknown>> = {}) {
        super(message);
        this.name = 'SmartCutPlanError';
        this.code = code;
        this.parameters = parameters;
    }
}

export function validSmartCutAnalysis(analysis: SpeechAnalysis | undefined, assetId: string, duration: number): analysis is SpeechAnalysis {
    return parseSmartCutAnalysis(analysis, { assetId, duration }).ok;
}

const round = (value: number) => Math.round(value * 100) / 100;
const floorHundredth = (value: number) => Math.floor(value * 100) / 100;
const ceilHundredth = (value: number) => Math.ceil(value * 100 - 1e-9) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const cleanText = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();

function scriptBeats(script: string): string[] {
    const text = cleanText(script);
    if (!text) return [];
    return text.split(/(?<=[.!?])\s+|\s*\n+\s*/u).map(cleanText).filter(Boolean).slice(0, 12);
}

function normaliseClips(clips: readonly SmartCutSource[]): SmartCutTake[] {
    const unique = new Map<string, SmartCutTake>();
    clips.map((clip, index) => {
        const duration = Number(clip.duration);
        const rangeStart = Math.max(0, Number(clip.rangeStart) || 0);
        const rangeEnd = Number.isFinite(Number(clip.rangeEnd)) ? Math.min(duration, Number(clip.rangeEnd)) : duration;
        return {
            id: String(clip.id || ''),
            assetId: String(clip.assetId || ''),
            name: cleanText(clip.name) || `Take ${index + 1}`,
            duration,
            rangeStart,
            rangeEnd,
        };
    }).filter((clip) => clip.id && clip.assetId && Number.isFinite(clip.duration) && clip.duration > 0 && clip.rangeEnd > clip.rangeStart)
        .forEach((clip) => { if (!unique.has(clip.id)) unique.set(clip.id, clip); });
    return [...unique.values()];
}

function segmentTiming(take: SmartCutTake, offset: number, wanted: number) {
    const start = Math.min(take.rangeEnd, ceilHundredth(clamp(offset, take.rangeStart, take.rangeEnd)));
    const length = floorHundredth(Math.min(wanted, take.rangeEnd - start));
    return { start, end: Math.min(take.rangeEnd, floorHundredth(start + length)) };
}

function retimeSegments(takes: readonly SmartCutTake[], segments: readonly SmartCutSegment[]): SmartCutSegment[] | null {
    const byId = new Map(takes.map((take) => [take.id, take]));
    const cursors = new Map(takes.map((take) => [take.id, take.rangeStart]));
    const timed: SmartCutSegment[] = [];
    for (const segment of segments) {
        const take = byId.get(segment.takeId);
        if (!take) return null;
        const cursor = cursors.get(take.id) ?? take.rangeStart;
        const timing = segmentTiming(take, cursor, segment.plannedLength);
        if (timing.end <= timing.start || timing.start < cursor) return null;
        cursors.set(take.id, timing.end);
        timed.push({ ...segment, start: timing.start, end: timing.end });
    }
    return timed;
}

export function smartCutPlanUsesAvailableTakes(plan: SmartCutPlan | null, clips: readonly SmartCutSource[]): boolean {
    const available = new Map(normaliseClips(clips).map((clip) => [clip.id, clip]));
    return Boolean(plan?.segments.length) && Boolean(plan?.segments.every((segment) => {
        const clip = available.get(segment.takeId);
        return clip && segment.end > segment.start && segment.start >= clip.rangeStart - 0.01 && segment.end <= clip.rangeEnd + 0.01;
    }));
}

export function smartCutPlanWithinLimits(plan: SmartCutPlan | null): boolean {
    if (!plan?.segments.length || plan.segments.length > SMART_CUT_MAX_SEGMENTS) return false;
    const total = plan.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
    return Number.isFinite(total) && total > 0 && total <= 60 + 1e-9;
}

/** A deterministic, local-only suggestion. People review every proposed cut before anything is created. */
export function buildSmartCutPlan({ clips, script = '', notes = '', pacing = 'balanced' }: { clips: readonly SmartCutSource[]; script?: string; notes?: string; pacing?: SmartCutPacing }): SmartCutPlan {
    const takes = normaliseClips(clips);
    if (!takes.length) throw new Error('Smart Cut needs at least one loaded video clip.');
    const pace = SMART_CUT_PACING[pacing] ?? SMART_CUT_PACING.balanced;
    const beats = scriptBeats(script);
    const labels = beats.length ? beats : takes.map((take, index) => `Review ${take.name}${takes.length === 1 ? '' : ` · section ${index + 1}`}`);
    const warnings = [
        'Local preview: speech, faces and technical quality are not analysed.',
        'Review every cut and take choice before creating the video.',
    ];
    if (takes.length === 1) warnings.push('Only one take is available, so alternate-take swapping is disabled.');
    if (!beats.length) warnings.push('No script was supplied; sections follow the selected clip order.');
    if (cleanText(notes)) warnings.push('Editing notes stay in this open workspace and are not sent to a provider.');

    let outputOffset = 0;
    const cursorByTake = new Map(takes.map((take) => [take.id, take.rangeStart]));
    const segments: SmartCutSegment[] = [];
    for (const [index, label] of labels.entries()) {
        const remaining = 60 - outputOffset;
        if (remaining < 0.01 || segments.length >= SMART_CUT_MAX_SEGMENTS) break;
        const wanted = Math.min(remaining, pace.seconds, Math.max(1.5, cleanText(label).split(' ').length / 2.5));
        const selected = Array.from({ length: takes.length }, (_, offset) => takes[(index + offset) % takes.length])
            .find((take) => (cursorByTake.get(take.id) ?? take.rangeStart) < take.rangeEnd - 0.01);
        if (!selected) break;
        const timing = segmentTiming(selected, cursorByTake.get(selected.id) ?? selected.rangeStart, wanted);
        if (timing.end <= timing.start) break;
        segments.push({
            id: `section-${index + 1}`,
            label,
            takeId: selected.id,
            start: timing.start,
            end: timing.end,
            outputOffset: round(outputOffset),
            plannedLength: wanted,
            matchStatus: 'Script line is not matched to speech in this local preview.',
            alternates: takes.filter((take) => take.id !== selected.id).map((take) => take.id),
            reason: takes.length > 1 ? `Rotated to ${selected.name} so adjacent sections do not default to one take.` : `${selected.name} is the only available take.`,
        });
        cursorByTake.set(selected.id, timing.end);
        outputOffset += timing.end - timing.start;
    }
    const totalDuration = round(segments.reduce((sum, segment) => sum + segment.end - segment.start, 0));
    if (segments.length < labels.length) warnings.push('The plan stopped at the 10-section, 60-second, or available-footage limit.');
    return { mode: 'local-demo', pacing, pacingLabel: pace.labelKey, notes: cleanText(notes), scriptProvided: beats.length > 0, takes, segments, totalDuration, warnings };
}

export function swapSmartCutTake(plan: SmartCutPlan, segmentId: string, takeId: string): SmartCutPlan {
    if (plan.mode === 'transcript-silence') return swapSpeechAwareCutTake(plan, segmentId, takeId) as SmartCutPlan;
    const take = plan.takes.find((item) => item.id === takeId);
    if (!take) return plan;
    const proposed = plan.segments.map((segment) => segment.id === segmentId ? {
        ...segment,
        takeId,
        alternates: plan.takes.filter((item) => item.id !== takeId).map((item) => item.id),
        reason: `You selected ${take.name} as the alternate for this section.`,
    } : segment);
    const segments = retimeSegments(plan.takes, proposed);
    if (!segments) return { ...plan, warnings: [...new Set([...plan.warnings, 'That take does not have enough unused footage; the previous choice remains selected.'])] };
    let outputOffset = 0;
    const positioned = segments.map((segment) => {
        const next = { ...segment, outputOffset: round(outputOffset) };
        outputOffset += segment.end - segment.start;
        return next;
    });
    const totalDuration = round(positioned.reduce((sum, segment) => sum + segment.end - segment.start, 0));
    return positioned.length > SMART_CUT_MAX_SEGMENTS || totalDuration > 60 ? plan : { ...plan, segments: positioned, totalDuration };
}

const SILENCE_PRESETS = Object.freeze({
    snappy: Object.freeze({ minimumSeconds: 0.4, edgePaddingSeconds: 0.08 }),
    natural: Object.freeze({ minimumSeconds: 0.75, edgePaddingSeconds: 0.12 }),
    relaxed: Object.freeze({ minimumSeconds: 1.2, edgePaddingSeconds: 0.18 }),
});

const silencePreset = (value: SmartCutPacing): keyof typeof SILENCE_PRESETS => value === 'balanced' ? 'natural' : value;
const analysisFor = (analyses: SpeechAnalyses, assetId: string): SpeechAnalysis | undefined => {
    if (analyses instanceof Map) return analyses.get(assetId);
    if (Array.isArray(analyses)) return analyses.find((analysis) => analysis.assetId === assetId);
    return (analyses as Readonly<Record<string, SpeechAnalysis>>)[assetId];
};

function transcriptGroups(analysis: SpeechAnalysis, clip: SmartCutTake, minimumSeconds: number): { groups: SpeechGroup[]; intersections: TrimIntersection[] } {
    const overlapping = analysis.chunks.filter((chunk) => chunk.end > clip.rangeStart && chunk.start < clip.rangeEnd);
    const intersections = overlapping.filter((chunk) => chunk.start < clip.rangeStart || chunk.end > clip.rangeEnd)
        .map((chunk) => ({ takeId: clip.id, start: chunk.start, end: chunk.end, text: chunk.text }));
    const entries = overlapping.filter((chunk) => chunk.start >= clip.rangeStart && chunk.end <= clip.rangeEnd).map((chunk) => ({
        start: chunk.start, end: chunk.end, text: chunk.text,
    }));
    const groups: SpeechGroup[] = [];
    for (const entry of entries) {
        const previous = groups.at(-1);
        if (!previous || entry.start - previous.end >= minimumSeconds) groups.push({ takeId: clip.id, start: entry.start, end: entry.end, entries: [entry] });
        else { previous.end = Math.max(previous.end, entry.end); previous.entries.push(entry); }
    }
    return { groups, intersections };
}

function padAndMerge(groups: readonly SpeechGroup[], clipById: ReadonlyMap<string, SmartCutTake>, padding: number, trimIntersections: readonly TrimIntersection[] = []): SpeechGroup[] {
    const padded = groups.map((group) => {
        const clip = clipById.get(group.takeId)!;
        const leadingBarrier = trimIntersections.filter((unit) => unit.takeId === group.takeId && unit.start < clip.rangeStart && unit.end > clip.rangeStart)
            .reduce((bound, unit) => Math.max(bound, unit.end), clip.rangeStart);
        const trailingBarrier = trimIntersections.filter((unit) => unit.takeId === group.takeId && unit.start < clip.rangeEnd && unit.end > clip.rangeEnd)
            .reduce((bound, unit) => Math.min(bound, unit.start), clip.rangeEnd);
        const start = Math.min(trailingBarrier, Math.max(leadingBarrier, ceilHundredth(group.start - padding)));
        return { ...group, start, end: Math.max(start, Math.min(floorHundredth(trailingBarrier), floorHundredth(group.end + padding))), entries: [...group.entries] };
    });
    const merged: SpeechGroup[] = [];
    for (const group of padded) {
        const previous = merged.at(-1);
        if (previous && previous.takeId === group.takeId && group.start <= previous.end) {
            previous.end = Math.max(previous.end, group.end); previous.entries.push(...group.entries);
        } else merged.push({ ...group, entries: [...group.entries] });
    }
    return merged;
}

function subtractRemovals(groups: readonly SpeechGroup[], removals: readonly SmartCutRemoval[]): SpeechGroup[] {
    const out: SpeechGroup[] = [];
    for (const group of groups) {
        const cuts = removals.filter((cut) => cut.takeId === group.takeId && cut.end > group.start && cut.start < group.end).sort((a, b) => a.start - b.start);
        if (!cuts.length) { out.push({ ...group, entries: [...group.entries] }); continue; }
        const pieces: (readonly [number, number])[] = [];
        let cursor = group.start;
        for (const cut of cuts) {
            if (cut.start > cursor) pieces.push([cursor, Math.min(cut.start, group.end)]);
            cursor = Math.max(cursor, cut.end);
        }
        if (cursor < group.end) pieces.push([cursor, group.end]);
        for (const [from, to] of pieces) {
            const start = ceilHundredth(from), end = floorHundredth(to);
            if (end - start < 0.1) continue;
            const entries = group.entries.filter((entry) => entry.end > start && entry.start < end);
            if (entries.length) out.push({ ...group, start, end, entries });
        }
    }
    return out;
}

function mergeToSegmentLimit(groups: readonly SpeechGroup[]): { groups: SpeechGroup[]; omitted: SpeechGroup[]; mergedCount: number } {
    const reduced = groups.map((group) => ({ ...group, entries: [...group.entries] }));
    while (reduced.length > SMART_CUT_MAX_SEGMENTS) {
        let candidate: { index: number; gap: number } | null = null;
        for (let index = 0; index < reduced.length - 1; index += 1) {
            const left = reduced[index], right = reduced[index + 1];
            if (left.takeId !== right.takeId) continue;
            const gap = Math.max(0, right.start - left.end);
            if (!candidate || gap < candidate.gap) candidate = { index, gap };
        }
        if (!candidate) break;
        const left = reduced[candidate.index], right = reduced[candidate.index + 1];
        reduced.splice(candidate.index, 2, { ...left, end: right.end, entries: [...left.entries, ...right.entries] });
    }
    return { groups: reduced.slice(0, SMART_CUT_MAX_SEGMENTS), omitted: reduced.slice(SMART_CUT_MAX_SEGMENTS), mergedCount: groups.length - reduced.length };
}

function completeGroupEnd(group: SpeechGroup, maximumEnd: number): number | null {
    if (group.end <= maximumEnd + 1e-9) return group.end;
    const complete = group.entries.filter((entry) => entry.end <= maximumEnd + 1e-9).at(-1);
    return complete ? Math.min(group.end, maximumEnd, ceilHundredth(complete.end)) : null;
}

function outputWindowEnd(take: SmartCutTake, candidateGroups: readonly SpeechGroup[], segments: readonly SmartCutSegment[]): number | null {
    const kept = segments.filter((segment) => segment.takeId === take.id).sort((a, b) => a.start - b.start);
    if (!kept.length) return null;
    const candidates = candidateGroups.filter((group) => group.takeId === take.id);
    const complete = candidates.every((group) => kept.some((segment) => segment.start <= group.start + 0.01 && segment.end >= group.end - 0.01));
    return complete ? take.rangeEnd : Math.max(...kept.map((segment) => segment.end));
}

function removedSecondsWithinOutput(takes: readonly SmartCutTake[], candidateGroups: readonly SpeechGroup[], segments: readonly SmartCutSegment[]): number {
    return takes.reduce((total, take) => {
        const kept = segments.filter((segment) => segment.takeId === take.id).sort((a, b) => a.start - b.start);
        if (!kept.length) return total;
        const windowEnd = outputWindowEnd(take, candidateGroups, segments)!;
        const keptSeconds = kept.reduce((sum, segment) => sum + Math.max(0, Math.min(windowEnd, segment.end) - Math.max(take.rangeStart, segment.start)), 0);
        return total + Math.max(0, windowEnd - take.rangeStart - keptSeconds);
    }, 0);
}

const speechLabel = (group: SpeechGroup, end = group.end) => {
    const value = cleanText(group.entries.filter((entry) => entry.start < end).map((entry) => entry.text).join(' '));
    if (!value) return 'Timed speech section';
    return value.length > 120 ? `${value.slice(0, 117).trimEnd()}…` : value;
};

/** Multi-take parity port of the web transcript-silence planner. */
function buildSpeechAwareCutPlanPort({ clips, analyses, script = '', notes = '', pacing = 'balanced', removals = [] }: {
    readonly clips: readonly SmartCutSource[];
    readonly analyses: SpeechAnalyses;
    readonly script?: string;
    readonly notes?: string;
    readonly languageOverride?: string;
    readonly pacing?: SmartCutPacing;
    readonly removals?: readonly SmartCutRemoval[];
}): SmartCutPlan {
    const takes = normaliseClips(clips);
    if (!takes.length) throw new Error('Speech-aware Smart Cut needs at least one loaded video clip.');
    if (takes.length > SMART_CUT_MAX_SEGMENTS) throw new SmartCutPlanError('source_clip_limit_reached', 'Speech-aware Smart Cut supports at most 10 source clips.', {
        sourceClips: takes.length, maximum: SMART_CUT_MAX_SEGMENTS,
    });
    const presetName = silencePreset(pacing), preset = SILENCE_PRESETS[presetName];
    const parsed = new Map<string, SpeechAnalysis>(), clipById = new Map(takes.map((take) => [take.id, take]));
    for (const take of takes) {
        const result = parseSmartCutAnalysis(analysisFor(analyses, take.assetId), { assetId: take.assetId, duration: take.duration });
        if (!result.ok) throw new Error(`Speech analysis for ${take.name} is unavailable or invalid (${result.error}).`);
        parsed.set(take.id, result.analysis);
    }
    const reviewed = removals.filter((cut) => {
        const take = clipById.get(cut.takeId);
        return take && Number.isFinite(cut.start) && Number.isFinite(cut.end) && cut.end > cut.start
            && cut.end > take.rangeStart && cut.start < take.rangeEnd;
    });
    const transcriptResults = takes.map((take) => transcriptGroups(parsed.get(take.id)!, take, preset.minimumSeconds));
    const rawGroups = transcriptResults.flatMap((result) => result.groups);
    const trimIntersections = transcriptResults.flatMap((result) => result.intersections);
    if (!rawGroups.length && trimIntersections.length) throw new SmartCutPlanError(
        'trim_intersects_unit',
        'No complete timed speech unit fits inside the selected clip ranges.',
        { reason: 'trim_intersects_all_units', units: trimIntersections },
    );
    if (!rawGroups.length) throw new Error('No timed speech was found inside the selected clip ranges.');
    const paddedGroups = padAndMerge(rawGroups, clipById, preset.edgePaddingSeconds, trimIntersections);
    const candidateGroups = subtractRemovals(paddedGroups, reviewed);
    const limited = mergeToSegmentLimit(candidateGroups);
    const groups = limited.groups;
    const segments: SmartCutSegment[] = [];
    const outputOmitted: SpeechGroup[] = [];
    let overBudgetUnit: SpeechGroup | null = null;
    let outputOffset = 0;
    for (const [index, group] of groups.entries()) {
        const remaining = 60 - outputOffset;
        if (remaining <= 0.01) { outputOmitted.push(...groups.slice(index)); break; }
        const cappedEnd = group.start + remaining;
        const end = completeGroupEnd(group, cappedEnd);
        if (end == null || end <= group.start) { overBudgetUnit = group; outputOmitted.push(...groups.slice(index)); break; }
        const start = ceilHundredth(group.start), length = round(end - start);
        if (length <= 0) continue;
        segments.push({
            id: `speech-${index + 1}`, label: speechLabel(group, end), takeId: group.takeId, start, end,
            outputOffset: round(outputOffset), plannedLength: length, matchStatus: 'Matched to timed transcript.', alternates: [],
            reason: `Kept transcript-backed speech from ${clipById.get(group.takeId)!.name}; pauses of at least ${preset.minimumSeconds.toFixed(2)} seconds were eligible for removal.`,
        });
        outputOffset = round(outputOffset + length);
        if (end < group.end - 0.01) {
            const entries = group.entries.filter((entry) => entry.end > end);
            if (entries.length) outputOmitted.push({ ...group, start: end, entries });
            outputOmitted.push(...groups.slice(index + 1));
            break;
        }
    }
    if (!segments.length && overBudgetUnit) throw new SmartCutPlanError('unit_exceeds_budget', 'The first complete timed speech unit is longer than the Clip Editor output budget.', {
        takeId: overBudgetUnit.takeId,
        start: overBudgetUnit.entries[0]?.start ?? overBudgetUnit.start,
        end: overBudgetUnit.entries[0]?.end ?? overBudgetUnit.end,
    });
    if (!segments.length) throw new Error('No usable speech sections fit inside the Clip Editor limits.');
    const totalDuration = round(segments.reduce((sum, segment) => sum + segment.end - segment.start, 0));
    const knownRemovals = reviewed.filter((cut) => paddedGroups.some((group) => group.takeId === cut.takeId && cut.end > group.start && cut.start < group.end));
    const keptAnyway = knownRemovals.filter((cut) => {
        const middle = (cut.start + cut.end) / 2;
        return segments.some((segment) => segment.takeId === cut.takeId && segment.start <= middle && middle < segment.end);
    });
    const appliedRemovals = knownRemovals.filter((cut) => {
        if (keptAnyway.includes(cut)) return false;
        const take = clipById.get(cut.takeId);
        if (!take) return false;
        const windowEnd = outputWindowEnd(take, candidateGroups, segments);
        return windowEnd !== null && cut.end > take.rangeStart && cut.start < windowEnd + 0.02;
    });
    const warningDetails: SmartCutWarning[] = [{ code: 'review_boundaries', parameters: {} }];
    if (trimIntersections.length) {
        warningDetails.push({ code: 'trim_intersects_unit', parameters: { count: trimIntersections.length, units: trimIntersections } });
    }
    if ([...parsed.values()].some((analysis) => analysis.timingQuality === 'phrase')) warningDetails.push({ code: 'phrase_timing', parameters: {} });
    if (cleanText(script)) warningDetails.push({ code: 'script_not_aligned', parameters: {} });
    if (keptAnyway.length) warningDetails.push({ code: 'removal_retained', parameters: { count: keptAnyway.length } });
    if (limited.mergedCount || limited.omitted.length) {
        warningDetails.push({ code: 'segment_limit_reached', parameters: { mergedGroups: limited.mergedCount, omittedGroups: limited.omitted.length, omitted: limited.omitted } });
    }
    if (outputOmitted.length) {
        warningDetails.push({ code: 'output_limit_reached', parameters: { count: outputOmitted.length, groups: outputOmitted } });
    }
    const warnings = warningDetails.map((warning) => warning.code);
    return {
        mode: 'transcript-silence', pacing: 'speech', pacingLabel: 'Speech aware', silencePreset: presetName,
        notes: cleanText(notes), scriptProvided: Boolean(cleanText(script)), takes, segments, totalDuration, silenceRemoved: round(removedSecondsWithinOutput(takes, candidateGroups, segments)),
        removalsApplied: appliedRemovals.length, analysisProviders: [...new Set([...parsed.values()].map((analysis) => analysis.provider))], warnings, warningDetails,
    };
}

/**
 * Mobile and web execute the same pure planner. The local port remains below as a
 * review oracle until the shared golden corpus covers every historical fixture.
 */
export function buildSpeechAwareCutPlan(input: {
    readonly clips: readonly SmartCutSource[];
    readonly analyses: SpeechAnalyses;
    readonly script?: string;
    readonly notes?: string;
    readonly languageOverride?: string;
    readonly pacing?: SmartCutPacing;
    readonly removals?: readonly SmartCutRemoval[];
}): SmartCutPlan {
    try {
        return buildCanonicalSpeechAwareCutPlan({
            ...input,
            silencePreset: input.pacing,
        }) as SmartCutPlan;
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && 'parameters' in error) {
            const value = error as { code: SmartCutWarning['code']; message?: string; parameters: Readonly<Record<string, unknown>> };
            throw new SmartCutPlanError(value.code, value.message || value.code, value.parameters);
        }
        throw error;
    }
}
