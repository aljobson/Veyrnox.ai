import { NextResponse } from 'next/server';
import { readBoundedBody } from '../../../../../lib/boundedBody.js';
import { envConfig, rpc, select } from '../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured } from '../../../../../packages/adapters/r2.js';
import { capabilityFor, checkSource } from '../../../../../lib/modelCapabilities.js';
import { readGenerationSources, resolveGenerationSources, sourceErrorStatus } from '../../../../../lib/generationSources.js';
import { seedance25Offer, seedance25Open, seedance25RawRefusal, seedance25Bill } from '../../../../../lib/seedance25Billing.js';
import { providerFor } from '../../../../../packages/provider-sdk/registry.js';
import { isFeatureKilled } from '../../../../../lib/runtimeSwitchCache.js';
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
// A read-only quote of owned, measured media; admission repeats the same measurement and exact-price check.
export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return reply({ error: 'not_authenticated' }, 401);
    const cfg = envConfig(), r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(r2cfg)) return reply({ error: 'gateway_not_configured' }, 503);
    let body;
    try { body = JSON.parse(new TextDecoder().decode(await readBoundedBody(req.body, 512 * 1024, req.signal))); }
    catch (error) { return reply({ error: error.status === 413 ? 'body_too_large' : 'invalid_json' }, error.status === 413 ? 413 : 400); }
    const id = body?.model_id;
    if (!seedance25Offer(id) || !seedance25Open(id)) return reply({ error: 'model_not_found' }, 404);
    if (isFeatureKilled('generation')) return reply({ error: 'feature_paused' }, 503);
    if (!body.inputs || typeof body.inputs !== 'object' || Array.isArray(body.inputs)) return reply({ error: 'inputs_must_be_object' }, 400);
    const refusal = seedance25RawRefusal(id, body.inputs);
    if (refusal) return reply({ error: refusal }, 400);
    if (body.consent !== true) return reply({ error: 'consent_required' }, 400);
    const refs = readGenerationSources(body);
    if (!refs.ok) return reply({ error: refs.error }, 400);
    try {
        // Separate 20-attempt/60s quote bucket: prompt edits must not consume generation admission.
        const rate = await rpc('consume_seedance25_quote_request', { p_auth_id: authId }, cfg);
        if (rate?.ok !== true) return reply({ error: rate?.code === 'RATE_LIMITED' ? 'rate_limited' : 'rate_check_unavailable' }, rate?.code === 'RATE_LIMITED' ? 429 : 503);
    } catch { return reply({ error: 'rate_check_unavailable' }, 503); }
    let row;
    try { [row] = await select('model_catalog', { columns: 'id,provider,provider_endpoint,credits_5s,active,gated_flag', filter: `id=eq.${id}`, limit: 1 }, cfg); }
    catch { return reply({ error: 'catalog_lookup_failed' }, 502); }
    if (!row?.active) return reply({ error: 'model_not_found' }, 404);
    if (row.gated_flag) return reply({ error: 'model_gated' }, 402);
    const endpoint = `crun:bytedance/seedance2-5-r2v:${id.endsWith('-edit') ? 'edit' : 'extend'}`;
    if (row.provider !== 'crun' || row.provider_endpoint !== endpoint) return reply({ error: 'provider_unsupported' }, 501);
    const record = capabilityFor(endpoint), provider = providerFor('crun');
    if (!provider.key()) return reply({ error: 'gateway_not_configured' }, 503);
    const resolved = await resolveGenerationSources({ authId, references: refs.references, record, r2cfg, dbcfg: cfg });
    if (!resolved.ok) return reply({ error: resolved.error }, sourceErrorStatus(resolved.error));
    const check = provider.check(record, row, { ...body.inputs, ...resolved.inputs });
    if (!check.ok) return reply({ error: check.error }, 400);
    const sourceCheck = checkSource(record, resolved.sources);
    if (!sourceCheck.ok) return reply({ error: sourceCheck.error }, 400);
    const bill = seedance25Bill(id, row.credits_5s, resolved.sources);
    if (!bill.ok) return reply({ error: bill.error }, 400);
    const { ok: _ok, ...quote } = bill;
    return reply({ model_id: id, ...quote });
}
