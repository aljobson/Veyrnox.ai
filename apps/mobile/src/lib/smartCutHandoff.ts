// Smart Cut's plan, handed to the on-device editor as one route param, so the cut is joined on the phone
// (free, no server job, no fal) instead of by a paid `clip-edit` job. The editor re-reads each clip's real length.
export const SMART_CUT_FPS = 30;
const MAX_CUTS = 10;
const MAX_SECONDS = 3600;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Cut = { readonly jobId: string; readonly start: number; readonly end: number };

export const encodeCuts = (cuts: readonly Cut[]): string => JSON.stringify(cuts.map(cut => [cut.jobId, cut.start, cut.end]));

export function decodeCuts(raw: string | undefined): Cut[] | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4000) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_CUTS) return null;
    const out: Cut[] = [];
    for (const item of parsed) {
        if (!Array.isArray(item) || item.length !== 3) return null;
        const [jobId, start, end] = item;
        if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) return null;
        if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) return null;
        if (start < 0 || end <= start || end > MAX_SECONDS) return null;
        out.push({ jobId, start, end });
    }
    return out;
}

export const cutFrames = (cut: Cut): { in: number; len: number } => ({
    in: Math.round(cut.start * SMART_CUT_FPS),
    len: Math.max(1, Math.round((cut.end - cut.start) * SMART_CUT_FPS)),
});
