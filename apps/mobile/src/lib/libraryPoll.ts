import type { Job, mediaApi } from './media';
export function inFlightIds(jobs: readonly Job[], limit = 24): string[] {
    return jobs.filter(j => j.state === 'queued' || j.state === 'running').slice(0, limit).map(j => j.job_id);
}
export function applyStatus(jobs: Job[], id: string, status: Awaited<ReturnType<ReturnType<typeof mediaApi>['getJob']>>): Job[] {
    const keys = ['state', 'credits', 'refunded', 'error_code'] as const;
    let changed = false;
    const next = jobs.map(j => {
        if (j.job_id !== id || keys.every(k => j[k] === status[k])) return j;
        changed = true;
        return { ...j, state: status.state, credits: status.credits, refunded: status.refunded, error_code: status.error_code };
    });
    return changed ? next : jobs;
}
export function mergePage(current: readonly Job[], page: readonly Job[]): Job[] {
    const replacements = new Map(page.map(j => [j.job_id, j]));
    const existing = new Set(current.map(j => j.job_id));
    return [...page.filter(j => !existing.has(j.job_id)), ...current.map(j => replacements.get(j.job_id) ?? j)];
}
