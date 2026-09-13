/**
 * Cloudflare Cron Trigger for the Top-up backfill (#94).
 *
 * GitHub Actions' 5-minute schedule never fired for top-up-backfill.yml and
 * fires other schedules hours late, so a lost webhook could wait
 * indefinitely. worker.js runs this every 5 minutes instead (wrangler.jsonc
 * `triggers.crons`). It hands the app's own fetch handler a POST to
 * /api/admin/top-up-backfill, in-process, so the route keeps its bearer check
 * and all the backfill logic. PUBLIC_HOST only names the origin of that
 * request; nothing leaves the Worker.
 */

const LOG = '[top-up-backfill-cron]';
const PATH = '/api/admin/top-up-backfill';

/**
 * @param {(req: Request, env: object, ctx: object) => Promise<Response>} appFetch  the OpenNext fetch handler
 * @param {{PUBLIC_HOST?: string, TOP_UP_BACKFILL_TOKEN?: string}} env
 * @param {object} ctx  the scheduled event's ExecutionContext
 * @param {{log?: (...a: any[]) => void}} [opts]
 * @returns {Promise<{ok: boolean, status: number|null}>}
 */
export async function runScheduledBackfill(appFetch, env, ctx, { log = console.error } = {}) {
    let url;
    try { url = new URL(PATH, env.PUBLIC_HOST); } catch { url = null; }
    if (!url || url.protocol !== 'https:' || !env.TOP_UP_BACKFILL_TOKEN) {
        log(LOG, 'not configured: PUBLIC_HOST (https) and TOP_UP_BACKFILL_TOKEN are required');
        return { ok: false, status: null };
    }

    let res;
    try {
        res = await appFetch(new Request(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${env.TOP_UP_BACKFILL_TOKEN}` },
        }), env, ctx);
    } catch (err) {
        log(LOG, 'backfill route threw:', err && err.message);
        return { ok: false, status: null };
    }
    if (!res.ok) log(LOG, 'backfill route answered', res.status);
    return { ok: res.ok, status: res.status };
}
