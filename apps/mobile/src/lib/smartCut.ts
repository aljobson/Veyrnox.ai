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
export interface SmartCutSegment {
    readonly id: string;
    readonly label: string;
    readonly takeId: string;
    readonly start: number;
    readonly end: number;
    readonly outputOffset: number;
    readonly plannedLength: number;
    readonly matchStatus: string;
    readonly alternates: readonly string[];
    readonly reason: string;
}
export interface SmartCutPlan {
    readonly mode: 'local-demo';
    readonly pacing: SmartCutPacing;
    readonly pacingLabel: string;
    readonly notes: string;
    readonly scriptProvided: boolean;
    readonly takes: readonly SmartCutTake[];
    readonly segments: readonly SmartCutSegment[];
    readonly totalDuration: number;
    readonly warnings: readonly string[];
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
