import * as SecureStore from 'expo-secure-store';
import { playSuccess } from './haptics';
import type { Job } from './media';
import { CHEER_MS, emitCelebration, reactVey, type CelebrationKind } from './veyMotion';
import { getCacheUser, subscribeCacheUser } from './appCache';

export const SUBMISSIONS_SLOT = 'veyrnox.celebrate.submissions.v1';
const OWNER_SLOT = 'veyrnox.celebrate.owner.v1';
const FIRST_SLOT = 'veyrnox.celebrate.first.v1';
const VIDEO_SLOT = 'veyrnox.celebrate.video.v1';
const ONBOARDING_SLOT = 'veyrnox.celebrate.onboarding.v1';
const DAY = 24 * 60 * 60 * 1000;
export type LocalSubmission = { jobId: string; expiresAt: number };
const read = (key: string) => {
    try {
        return SecureStore.getItem(key);
    } catch {
        return null;
    }
};
const write = (key: string, value: string) => {
    try {
        SecureStore.setItem(key, value);
    } catch {
        /* Memory still deduplicates this launch. */
    }
};
export function parseSubmissions(raw: string | null, now: number): LocalSubmission[] {
    try {
        const value: unknown = JSON.parse(raw ?? '[]');
        if (!Array.isArray(value)) return [];
        const unique = new Map<string, LocalSubmission>();
        for (const item of value)
            if (item && typeof item.jobId === 'string' && item.jobId && Number.isFinite(item.expiresAt) && item.expiresAt > now)
                unique.set(item.jobId, { jobId: item.jobId, expiresAt: item.expiresAt });
        return [...unique.values()].slice(-50);
    } catch {
        return [];
    }
}
export function isNewCompletion(input: { succeeded: boolean; sawUnfinished: boolean; jobId: string; submissions: readonly LocalSubmission[]; now: number }): boolean {
    return input.succeeded && (input.sawUnfinished || input.submissions.some((entry) => entry.jobId === input.jobId && entry.expiresAt > input.now));
}
let submissions = parseSubmissions(read(SUBMISSIONS_SLOT), Date.now());
let owner = read(OWNER_SLOT);
let firstShown = read(FIRST_SLOT) === '1';
let videoShown = read(VIDEO_SLOT) === '1';
let onboarding = read(ONBOARDING_SLOT) === '1';
let seen: ReadonlyMap<string, boolean> | null = null;
const completed = new Map<string, CelebrationResult>();
let epoch = 0;
const pending = new Set<string>();
let active: CelebrationResult | null = null;
let firstPending = false;
let videoPending = false;
const persist = () => write(SUBMISSIONS_SLOT, JSON.stringify(submissions));
function prune() {
    submissions = submissions.filter((entry) => entry.expiresAt > Date.now()).slice(-50);
    persist();
}
// The cache owner survives normal restarts. Sign-out and a different owner clear submission evidence.
function checkOwner() {
    const next = getCacheUser() ?? null;
    if (next === owner) return;
    owner = next;
    submissions = [];
    persist();
    write(OWNER_SLOT, next ?? '');
    seen = null;
    completed.clear();
    pending.clear();
    epoch++;
}
subscribeCacheUser(checkOwner);
prune();
export function noteLocalSubmission(jobId: string): void {
    if (!jobId) return;
    checkOwner();
    prune();
    submissions = [...submissions.filter((entry) => entry.jobId !== jobId), { jobId, expiresAt: Date.now() + DAY }].slice(-50);
    persist();
}
export function noteOnboardingCompleted(): void {
    onboarding = true;
    write(ONBOARDING_SLOT, '1');
}
export function newlyFinished(previous: ReadonlyMap<string, boolean> | null, jobs: readonly Job[]): Job[] {
    if (!previous) return [];
    return jobs.filter((job) => job.state === 'succeeded' && previous.get(job.job_id) === false);
}
export type CelebrationResult = { big: boolean; done: Promise<void> };
const quiet: CelebrationResult = { big: false, done: Promise.resolve() };
export function celebrateOutput(jobId: string, mime: string, sawUnfinished: boolean): CelebrationResult {
    const previous = completed.get(jobId);
    if (previous) return previous;
    prune();
    if (!isNewCompletion({ jobId, succeeded: true, sawUnfinished, submissions, now: Date.now() })) return quiet;
    const video = mime.startsWith('video/');
    const kind: CelebrationKind | null = !(firstShown || firstPending)
        ? onboarding
            ? 'afterOnboarding'
            : 'firstCreation'
        : video && !(videoShown || videoPending)
          ? 'firstVideo'
          : null;
    if (kind) {
        let resolve!: () => void;
        const result = {
            big: true,
            done: new Promise<void>((done) => {
                resolve = done;
            }),
        };
        let shown = false;
        firstPending = true;
        if (video) videoPending = true;
        const accepted = emitCelebration({
            kind,
            onShown: () => {
                shown = true;
                firstShown = true;
                write(FIRST_SLOT, '1');
                if (video) {
                    videoShown = true;
                    write(VIDEO_SLOT, '1');
                }
                submissions = submissions.filter((entry) => entry.jobId !== jobId);
                persist();
            },
            onDone: () => {
                firstPending = false;
                if (video) videoPending = false;
                if (!shown) completed.delete(jobId);
                if (active === result) active = null;
                resolve();
            },
        });
        if (accepted) {
            active = result;
            completed.set(jobId, result);
            return result;
        }
        firstPending = false;
        if (video) videoPending = false;
        resolve();
        // No visible host: leave milestone flags and submission evidence untouched for the next visit.
        return quiet;
    }
    completed.set(jobId, quiet);
    submissions = submissions.filter((entry) => entry.jobId !== jobId);
    persist();
    reactVey('cheer', CHEER_MS);
    void playSuccess();
    return quiet;
}

// Existing callers can still request the small cheer synchronously. Home passes a verified output loader;
// the big celebration never starts until that succeeds. An aborted or inaccessible output consumes nothing.
export function celebrateFinished(jobs: readonly Job[], loadOutput?: (id: string) => Promise<{ mime_type: string }>, signal?: AbortSignal): number {
    prune();
    const finished = new Set(newlyFinished(seen, jobs).map((job) => job.job_id));
    const done = jobs.filter(
        (job) =>
            isNewCompletion({ jobId: job.job_id, succeeded: job.state === 'succeeded', sawUnfinished: finished.has(job.job_id), submissions, now: Date.now() }) &&
            !completed.has(job.job_id),
    );
    seen = new Map(jobs.map((job) => [job.job_id, job.state === 'succeeded']));
    if (!loadOutput) {
        if (done.length) {
            done.forEach((job) => completed.set(job.job_id, quiet));
            reactVey('cheer', CHEER_MS);
            void playSuccess();
        }
        return done.length;
    }
    const generation = epoch;
    for (const job of done) {
        if (pending.has(job.job_id)) continue;
        pending.add(job.job_id);
        void loadOutput(job.job_id)
            .then(async (output) => {
                if (signal?.aborted || generation !== epoch) return;
                // Keep bursts separate if several jobs finish together.
                if (active) await active.done;
                if (!signal?.aborted && generation === epoch) celebrateOutput(job.job_id, output.mime_type, finished.has(job.job_id));
            })
            .catch(() => {})
            .finally(() => {
                pending.delete(job.job_id);
            });
    }
    return done.length;
}

// Abortable waiting removes its listener on either completion or cancellation.
export function afterCelebration(result: CelebrationResult, delayMs: number, signal: AbortSignal, callback: () => void): () => void {
    let live = !signal.aborted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
        live = false;
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
    };
    signal.addEventListener('abort', cancel, { once: true });
    const fire = () => {
        if (!live || signal.aborted) return;
        if (active) {
            void active.done.then(fire);
            return;
        }
        cancel();
        callback();
    };
    const showing = result.big ? result : active;
    if (showing) void showing.done.then(fire);
    else if (live) timer = setTimeout(fire, delayMs);
    return cancel;
}
export function resetCelebrations(): void {
    seen = null;
    completed.clear();
    pending.clear();
    epoch++;
}
