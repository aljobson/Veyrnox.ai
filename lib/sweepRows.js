/**
 * Which pending jobs one minute sweep reads. The sweeps used to read only the oldest BATCH rows, so once that many
 * older jobs were still rendering at the provider, every finished job behind them was never reached
 * (scripts/simulate-poll-load.mjs: 300 pending, oldest 60 rendering -> 0 settled in 5 sweeps).
 *
 * Now half the batch is still the oldest rows (they carry the timeout rule and the longest waits) and the other half is
 * a window that moves on each minute through the rows behind them, so every pending job is reached within
 * ROTATION_SPAN / rotating minutes. The number of provider reads per sweep does not change, so the cron's
 * subrequest and memory use is the same as before.
 */
import { select } from '../packages/db/supabase-client.js';

/** How far behind the oldest block the moving window travels before it starts over. */
export const ROTATION_SPAN = 500;

const asRows = (r) => (Array.isArray(r) ? r : []);

/**
 * @param {{columns: string, filter: string, only?: string, now?: Date, cfg: object, batch: number}} q
 *   `filter` is the whole PostgREST filter without order or limit; `only` is non-empty for a one-job check.
 */
export async function sweepRows({ columns, filter, only = '', now = new Date(), cfg, batch }) {
    const ask = (extra) => select('jobs', { columns, filter: `${filter}&order=created_at.asc&${extra}` }, cfg).then(asRows);
    if (only) return ask(`limit=${batch}`);
    const oldest = Math.ceil(batch / 2);
    const rotating = batch - oldest;
    const first = await ask(`limit=${oldest}`);
    if (first.length < oldest) return first;
    const minute = Math.floor(now.getTime() / 60_000);
    // A window that starts past the end of the table is empty: wrap sooner (halve the span) until it lands on rows.
    // Each retry is one cheap jobs query, not a provider read.
    let more = [];
    for (let span = ROTATION_SPAN; ; span = Math.ceil(span / 2)) {
        const offset = span <= rotating ? oldest : oldest + ((minute * rotating) % span);
        more = await ask(`limit=${rotating}&offset=${offset}`);
        if (more.length || offset === oldest) break;
    }
    const seen = new Set(first.map((r) => r.id));
    return [...first, ...more.filter((r) => !seen.has(r.id))];
}
