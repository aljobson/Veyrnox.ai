import { readAccountLanguage } from '../../../../lib/accountLanguage.js';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { createHelpPlan, helpApiKey, helpNeedsCatalog } from '../../../../lib/helpAssistant.js';
import { normaliseHelpPlan, parseHelpRequest } from '../../../../lib/productHelp.js';
import { accountAnswerPlan, accountUnavailablePrefix, helpNeedsAccount, readAccountSnapshot, veyAccountEnabled } from '../../../../lib/veyAccount.js';
import { readPublicCatalog } from '../../../../lib/publicCatalog.js';
import { providerSpendLimit } from '../../../../lib/providerSpend.js';

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

    // ADR-0103: a charge or balance question reads this caller's own rows, here on the server, and is answered
    // from a template. The model gets no tool, no id and none of this data.
    let accountReadFailed = false;
    if (veyAccountEnabled(process.env) && helpNeedsAccount(parsed.question)) {
        try {
            const snapshot = await readAccountSnapshot(authId, cfg);
            return reply({ plan: { ...accountAnswerPlan(snapshot), source: 'account' } });
        } catch {
            console.error('[help] account read failed');
            accountReadFailed = true;
        }
    }

    let catalog = [];
    if (helpNeedsCatalog(parsed.question)) {
        try { catalog = await readPublicCatalog({ cfg }); }
        catch (error) { console.error('[help] catalog unavailable:', error?.message); }
    }
    // Help stays useful from the reviewed local guide when its small-model
    // supplier allowance is closed. Never call upstream without a durable
    // reservation, even though this feature is free to the account.
    let allowAi = false;
    if (!accountReadFailed && helpApiKey(process.env)) {
        try {
            const admitted = await rpc('provider_spend_admit_custom_auth', {
                p_auth_id: authId,
                p_effect_key: `help:${crypto.randomUUID()}`,
                p_provider: 'openrouter-help',
                p_purpose: 'product-help',
                p_cost_microusd: 10000,
            }, cfg);
            allowAi = admitted?.ok === true && !providerSpendLimit(admitted);
        } catch (error) {
            console.error('[help] supplier spend admission failed:', error?.message);
        }
    }
    const locale = allowAi ? await readAccountLanguage(authId, cfg) : null;
    const plan = await createHelpPlan({ ...parsed, catalog, allowAi, locale });
    if (accountReadFailed) return reply({ plan: normaliseHelpPlan({ ...plan, message: accountUnavailablePrefix() + plan.message }) });
    return reply({ plan });
}

