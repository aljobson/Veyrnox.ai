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
import { sweepHiggsfield } from './higgsfieldSweep.js';
import { envConfig as r2EnvConfig } from '../packages/adapters/r2.js';

// Sized for ~10,000 jobs in flight: each check costs a jobs query and a provider read, so a job is checked at most
// once per THROTTLE_MS (+ random jitter so isolates do not line up), never in its first MIN_AGE_MS (a video is
// never done that fast), and one isolate runs at most MAX_CONCURRENT checks at once.
export const THROTTLE_MS = 12_000;
export const JITTER_MS = 3_000;
export const MIN_AGE_MS = 30_000;
export const MAX_CONCURRENT = 5;
const MAX_TRACKED = 2000;
const nextAllowed = new Map();
let running = 0;

/** Provider name -> [sweep, env key, optional on-switch]. */
const SWEEPS = Object.freeze({
    grsai: [sweepGrsai, 'GRSAI_API_KEY', null],
    byteplus: [sweepByteplus, 'BYTEPLUS_API_KEY', null],
    crun: [sweepCrun, 'CRUN_API_KEY', 'CRUN_ENABLED'],
    higgsfield: [sweepHiggsfield, 'HIGGSFIELD_API_KEY', 'HIGGSFIELD_ENABLED'],
});

/**
 * @param {{id: string, provider?: string, state?: string}} job the row as get_user_job returns it, plus its id
 * @returns {Promise<boolean>} true when a provider read ran and applied a result
 */
export async function refreshPolledJob({ job, cfg, env = process.env, now = Date.now(), r2cfg = r2EnvConfig(), sweeps = SWEEPS, random = Math.random }) {
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
        if (nextAllowed.size >= MAX_TRACKED) nextAllowed.clear();
        nextAllowed.set(job.id, now + THROTTLE_MS + Math.floor(random() * JITTER_MS));
        running += 1; counted = true;
        const out = await sweep({ cfg, r2cfg, apiKey, onlyJobId: job.id });
        return Boolean(out && out.applied > 0);
    } catch {
        console.error('[refresh-polled-job] check failed');
        return false;
    } finally {
        if (counted) running -= 1;
    }
}

export function resetRefreshThrottle() { nextAllowed.clear(); running = 0; }
