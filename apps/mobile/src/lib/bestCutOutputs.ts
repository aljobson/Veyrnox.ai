import { validateBestCutPlan, type BestCutInput, type BestCutPlan, type BestCutRange } from './bestCutPlan';

const integer = (value: unknown): value is number => Number.isSafeInteger(value);

function omittedRanges(plan: BestCutPlan, inputs: readonly BestCutInput[]): BestCutRange[] {
    const known = new Set(inputs.map(input => input.mediaId));
    const rows = plan.warningDetails
        .filter(warning => warning.code === 'output_limit_reached')
        .flatMap(warning => Array.isArray(warning.parameters.omitted) ? warning.parameters.omitted : []);
    return rows.flatMap((value): BestCutRange[] => {
        if (!value || typeof value !== 'object') return [];
        const row = value as Partial<BestCutRange>;
        if (typeof row.mediaId !== 'string' || !known.has(row.mediaId) || !integer(row.from) || !integer(row.to)
            || row.from < 0 || row.to <= row.from || typeof row.label !== 'string') return [];
        return [{ mediaId: row.mediaId, from: row.from, to: row.to, start: 0, label: row.label.slice(0, 200) }];
    });
}

/**
 * Turns the planner's safe 60-second first cut plus its explicit omitted tail into
 * independent, validated short-form outputs. It never invents ranges, reuses source
 * frames, or cuts beyond the provider timings.
 */
export function bestCutOutputPlans(plan: BestCutPlan, inputs: readonly BestCutInput[], requested: number): BestCutPlan[] {
    const count = Math.max(1, Math.min(5, Math.floor(requested)));
    if (count === 1) return [plan];
    if (!validateBestCutPlan(plan, [...inputs])) return [];
    const all = [...plan.ranges.map(range => ({ ...range, start: 0 })), ...omittedRanges(plan, inputs)];
    if (all.length === plan.ranges.length) return [plan];
    const outputs: BestCutPlan[] = [];
    let cursor = 0;
    while (cursor < all.length && outputs.length < count) {
        const ranges: BestCutRange[] = [];
        let frames = 0;
        while (cursor < all.length && ranges.length < 10) {
            const candidate = all[cursor];
            const length = candidate.to - candidate.from;
            if (frames && frames + length > 60 * plan.fps) break;
            if (!frames && length > 60 * plan.fps) {
                ranges.push({ ...candidate, to: candidate.from + 60 * plan.fps, start: 0 });
                all[cursor] = { ...candidate, from: candidate.from + 60 * plan.fps };
                frames = 60 * plan.fps;
                break;
            }
            ranges.push({ ...candidate, start: frames });
            frames += length;
            cursor += 1;
        }
        if (!ranges.length) break;
        const more = cursor < all.length;
        const warnings: BestCutPlan['warnings'] = plan.warnings.filter(code => code !== 'output_limit_reached');
        const warningDetails: BestCutPlan['warningDetails'] = plan.warningDetails.filter(warning => warning.code !== 'output_limit_reached');
        if (more && outputs.length + 1 === count) {
            warnings.push('output_limit_reached');
            warningDetails.push({ code: 'output_limit_reached', parameters: { count: all.length - cursor, omitted: all.slice(cursor) } });
        }
        const output: BestCutPlan = {
            ...plan,
            ranges,
            removedPauses: outputs.length ? 0 : plan.removedPauses,
            removedRetakes: outputs.length ? 0 : plan.removedRetakes,
            removedRepeats: outputs.length ? 0 : plan.removedRepeats,
            matchedLines: outputs.length ? 0 : plan.matchedLines,
            missingLines: outputs.length ? [] : plan.missingLines,
            warnings,
            warningDetails,
        };
        if (!validateBestCutPlan(output, [...inputs])) return [];
        outputs.push(output);
    }
    return outputs;
}

/** Music Video keeps imported performances as complete source sections and omits speech captions. */
export function musicVideoPlan(inputs: readonly BestCutInput[], fps = 30): BestCutPlan | null {
    if (!inputs.length || inputs.length > 10 || ![24, 25, 30, 60].includes(fps)) return null;
    const ranges: BestCutRange[] = [];
    const omitted: BestCutRange[] = [];
    let cursor = 0;
    for (const [index, input] of inputs.entries()) {
        const sourceFrames = Math.floor(input.analysis.duration * fps);
        const remaining = 60 * fps - cursor;
        const range = { mediaId: input.mediaId, from: 0, to: sourceFrames, start: cursor, label: `Music section ${index + 1}` };
        if (remaining <= 0) { omitted.push({ ...range, start: 0 }); continue; }
        if (sourceFrames > remaining) {
            ranges.push({ ...range, to: remaining, start: cursor });
            omitted.push({ ...range, from: remaining, start: 0 });
            cursor += remaining;
            continue;
        }
        ranges.push(range);
        cursor += sourceFrames;
    }
    const plan: BestCutPlan = {
        fps,
        ranges,
        removedPauses: 0,
        removedRetakes: 0,
        removedRepeats: 0,
        matchedLines: 0,
        missingLines: [],
        droppedClips: 0,
        warnings: omitted.length ? ['output_limit_reached'] : [],
        warningDetails: omitted.length ? [{ code: 'output_limit_reached', parameters: { count: omitted.length, omitted } }] : [],
    };
    return validateBestCutPlan(plan, [...inputs]) ? plan : null;
}
