/**
 * Providers whose jobs are completed by a polling sweep, not a signed callback (worker.js, every minute).
 * They never write webhook_events, so the Webhooks page cannot show them; this reads their in-flight jobs.
 * Read-only: nothing here touches a job, the ledger or a provider. TIMEOUT_MINUTES mirror the sweeps
 * (lib/grsaiSweep.js, byteplusSweep.js, crunSweep.js), which fail and refund a job past that age.
 */
import { select } from '../packages/db/supabase-client.js';

export const POLLED_PROVIDERS = Object.freeze({
    grsai: { timeoutMinutes: 30 },
    byteplus: { timeoutMinutes: 45 },
    crun: { timeoutMinutes: 45 },
});
// A job still SUBMITTED this long after its sweep would have failed it means the sweep is not running.
export const OVERDUE_SLACK_MINUTES = 5;
export const PEEK = 500;

const NAMES = Object.keys(POLLED_PROVIDERS);

export async function readPolledProviders(cfg, { now = new Date(), crunEnabled = process.env.CRUN_ENABLED === 'true' } = {}) {
    const rows = await select('jobs', {
        columns: 'provider,created_at',
        filter: `provider=in.(${NAMES.join(',')})&provider_job_id=not.is.null&state=eq.SUBMITTED&order=created_at.asc&limit=${PEEK}`,
    }, cfg);
    const jobs = Array.isArray(rows) ? rows : [];
    const providers = NAMES.map((provider) => {
        const own = jobs.filter((j) => j.provider === provider);
        const ages = own.map((j) => Math.max(0, (now.getTime() - new Date(j.created_at).getTime()) / 60_000)).filter(Number.isFinite);
        const limit = POLLED_PROVIDERS[provider].timeoutMinutes + OVERDUE_SLACK_MINUTES;
        return {
            provider,
            sweep_enabled: provider === 'crun' ? crunEnabled : true,
            timeout_minutes: POLLED_PROVIDERS[provider].timeoutMinutes,
            in_flight: own.length,
            oldest_minutes: ages.length ? Math.round(Math.max(...ages)) : null,
            overdue: ages.filter((a) => a > limit).length,
        };
    });
    return { providers, capped: jobs.length >= PEEK };
}
