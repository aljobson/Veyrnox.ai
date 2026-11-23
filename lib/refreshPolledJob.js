/**
 * Check-on-read for providers that send no signed callback (GrsAI, BytePlus, Crun, Higgsfield).
 * Their jobs are otherwise found by the per-minute sweep, up to 60 s after the provider finished.
 * When the owner reads a job that is still SUBMITTED, settle that one job now with the same sweep code
 * (same completeJob, same idempotent RPCs, same timeout rule), limited to one id.
 *
 * Best effort: never throws, never changes the answer's shape. Limits are below; the minute sweep stays the backstop.
 */
import { sweepGrsai } from './grsaiSweep.js';
import { sweepByteplus } from './byteplusSweep.js';
import { sweepCrun } from './crunSweep.js';
import { sweepCrunSunoMusic } from './crunSunoSweep.js';
import { sweepHiggsfield } from './higgsfieldSweep.js';
import { envConfig as r2EnvConfig } from '../packages/adapters/r2.js';

// Sized for ~10,000 jobs in flight: each check costs a jobs query and a provider read, so a job is checked at most
// once per THROTTLE_MS (+ random jitter so checks do not line up), never in its first MIN_AGE_MS (a video is
// never done that fast), and one isolate runs at most MAX_CONCURRENT checks at once.
//
// The once-per-THROTTLE_MS rule is shared by every isolate in a data centre through the Workers Cache API
// (`cacheThrottle`). A per-isolate map alone does not hold: a client polling every 2 s lands on a different isolate
// each time, so with 100 isolates the same job was checked about 3.6 times more often than intended (measured by
// scripts/simulate-poll-load.mjs). The per-isolate map stays as the cheap first filter and as the fallback where
// the Cache API does not exist.
export const THROTTLE_MS = 12_000;
export const JITTER_MS = 3_000;
export const MIN_AGE_MS = 30_000;
export const MAX_CONCURRENT = 5;
export const MAX_TRACKED = 2000;
const nextAllowed = new Map();
let running = 0;

const cacheKey = (jobId) => `https://veyrnox.ai/__internal/polled-job-check/v1/${jobId}`;

/** Shared across isolates in one data centre. Best effort: a failure or a missing Cache API allows the check. */
export const cacheThrottle = {
    /** @returns {Promise<boolean>} true when this caller may check the job now (and claims the next `seconds`) */
    async claim(jobId, seconds) {
        if (typeof caches === 'undefined' || !caches.default) return true;
        try {
            const key = cacheKey(jobId);
            if (await caches.default.match(key)) return false;
            await caches.default.put(key, new Response('1', { headers: { 'Cache-Control': `max-age=${seconds}` } }));
            return true;
        } catch { return true; }
    },
};

/** Drop the oldest tenth when full; the earlier `clear()` forgot every job at once, which re-opened them all. */
function trim(map) {
    if (map.size < MAX_TRACKED) return;
    const keep = Math.floor(MAX_TRACKED * 0.9);
    for (const k of map.keys()) { if (map.size <= keep) break; map.delete(k); }
}

/** Provider name -> [sweep, env key, optional on-switch]. */
async function sweepCrunOnRead(args) {
    const [media, music] = await Promise.all([sweepCrun(args), sweepCrunSunoMusic(args)]);
    if (media?.skipped && music?.skipped) return music;
    return {
        checked: (media?.checked || 0) + (music?.checked || 0),
        applied: (media?.applied || 0) + (music?.applied || 0),
        pending: (media?.pending || 0) + (music?.pending || 0),
        errors: (media?.errors || 0) + (music?.errors || 0),
    };
}

const SWEEPS = Object.freeze({
    grsai: [sweepGrsai, 'GRSAI_API_KEY', null],
    byteplus: [sweepByteplus, 'BYTEPLUS_API_KEY', null],
    crun: [sweepCrunOnRead, 'CRUN_API_KEY', 'CRUN_ENABLED'],
    higgsfield: [sweepHiggsfield, 'HIGGSFIELD_API_KEY', 'HIGGSFIELD_ENABLED'],
});

/**
 * @param {{id: string, provider?: string, state?: string}} job the row as get_user_job returns it, plus its id
 * @returns {Promise<boolean>} true when a provider read ran and applied a result
 */
export async function refreshPolledJob({ job, cfg, env = process.env, now = Date.now(), r2cfg = r2EnvConfig(), sweeps = SWEEPS, random = Math.random, shared = cacheThrottle }) {
    let counted = false;
    try {
        const entry = sweeps[job?.provider];
        if (!entry || job.state !== 'SUBMITTED' || typeof job.id !== 'string') return false;
        const [sweep, keyName, switchName] = entry;
        if (switchName && env[switchName] !== 'true') return false;
        const apiKey = env[keyName];
        if (!apiKey) return false;
        const created = Date.parse(job.created_at);
        if (Number.isFinite(created) && now - created < MIN_AGE_MS) return false;
        const allowedAt = nextAllowed.get(job.id);
        if (allowedAt !== undefined && now < allowedAt) return false;
        if (running >= MAX_CONCURRENT) return false;
        // Take the slot before any await, so a burst of reads cannot all pass the cap while one is still waiting.
        running += 1; counted = true;
        const wait = job.provider === 'crun'
            ? 15_000 + Math.floor(random() * 15_001)
            : THROTTLE_MS + Math.floor(random() * JITTER_MS);
        if (!(await shared.claim(job.id, Math.ceil(wait / 1000)))) return false;
        trim(nextAllowed);
        nextAllowed.set(job.id, now + wait);
        const out = await sweep({ cfg, r2cfg, apiKey, onlyJobId: job.id });
        return Boolean(out && out.applied > 0);
    } catch (err) {
        // Job id, provider and the error's own message; never the key or the provider payload.
        console.error('[refresh-polled-job] check failed', job?.id, job?.provider, err instanceof Error ? err.message : 'unknown error');
        return false;
    } finally {
        if (counted) running -= 1;
    }
}

export function resetRefreshThrottle() { nextAllowed.clear(); running = 0; }
