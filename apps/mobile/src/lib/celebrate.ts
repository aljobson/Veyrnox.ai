import { playSuccess } from './haptics';
import type { Job } from './media';
import { CHEER_MS, reactVey } from './veyMotion';

// Which creations were finished the last time the list was read. Null until the first read, so opening the app with
// old creations in the list celebrates nothing: only a creation seen unfinished and then finished does.
let seen: ReadonlyMap<string, boolean> | null = null;

export function newlyFinished(previous: ReadonlyMap<string, boolean> | null, jobs: readonly Job[]): Job[] {
    if (!previous) return [];
    return jobs.filter((j) => j.state === 'succeeded' && previous.get(j.job_id) === false);
}

// Called with each fresh read of the jobs list. Vey cheers and the phone buzzes once, however many finished together.
// Motion and a buzz only: nothing here reads or changes a balance.
export function celebrateFinished(jobs: readonly Job[]): number {
    const done = newlyFinished(seen, jobs);
    seen = new Map(jobs.map((j) => [j.job_id, j.state === 'succeeded']));
    if (done.length === 0) return 0;
    reactVey('cheer', CHEER_MS);
    void playSuccess();
    return done.length;
}

export function resetCelebrations(): void {
    seen = null;
}
