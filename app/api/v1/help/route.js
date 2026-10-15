import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { createHelpPlan, helpNeedsCatalog } from '../../../../lib/helpAssistant.js';
import { parseHelpRequest } from '../../../../lib/productHelp.js';
import { readPublicCatalog } from '../../../../lib/publicCatalog.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200, headers = {}) => Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
});

/** POST /api/v1/help — free, rate-limited product guidance. */
export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!UUID.test(authId || '')) return reply({ error: 'not_authenticated' }, 401);

    let body;
    try { body = await req.json(); } catch { return reply({ error: 'invalid_request' }, 400); }
    const parsed = parseHelpRequest(body);
    if (!parsed.ok) return reply({ error: parsed.error }, 400);

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const rate = await rpc('consume_account_read_request', { p_auth_id: authId }, cfg);
        if (rate?.code === 'RATE_LIMITED') {
            const seconds = Math.max(1, Math.min(60, Number(rate.retry_after_seconds) || 60));
            return reply({ error: 'rate_limited' }, 429, { 'Retry-After': String(seconds) });
        }
        if (!rate || rate.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
    } catch (error) {
        console.error('[help] rate limit failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 503);
    }

    let catalog = [];
    if (helpNeedsCatalog(parsed.question)) {
        try { catalog = await readPublicCatalog({ cfg }); }
        catch (error) { console.error('[help] catalog unavailable:', error?.message); }
    }
    const plan = await createHelpPlan({ ...parsed, catalog });
    return reply({ plan });
}

