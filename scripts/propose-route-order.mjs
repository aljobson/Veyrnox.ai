#!/usr/bin/env node
/**
 * Propose, and with --apply make, a cheaper supplier-route order (ADR-0256 phase 4b).
 * OWNER-RUN, PROD SERVICE KEY. Default is a dry run that changes nothing.
 *
 *   read -s "SUPABASE_SERVICE_ROLE_KEY?service key: "; export SUPABASE_SERVICE_ROLE_KEY
 *   export SUPABASE_URL=https://<production project>.supabase.co
 *   node scripts/propose-route-order.mjs                                  # dry run
 *   node scripts/propose-route-order.mjs --apply --note "weekly review"   # one reorder per changed offer
 *   unset SUPABASE_SERVICE_ROLE_KEY
 *
 * Before proposing a first route it checks that the Worker can dispatch it: an adapter in the
 * provider registry and a capability record for the endpoint. Otherwise that offer would answer
 * 501 until reordered back, and the proposal is dropped. Each applied change goes through
 * model_route_reorder (0374), which logs it and applies the margin and free-allowance checks.
 */
import { select, rpc, envConfig } from '../packages/db/supabase-client.js';
import { providerFor } from '../packages/provider-sdk/registry.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { proposeOrder } from '../lib/supplierRoutesPropose.js';

// A supplier whose adapter is registered but dark until its flag is on in the Worker. The flag is read from this shell:
// set CRUN_ENABLED=true here only when it is on in the Worker, or a Crun route would be proposed as first and answer 503.
const GATED_BY_FLAG = { crun: 'CRUN_ENABLED' };
export const canDispatch = (route) => Boolean(providerFor(route.supplier))
    && capabilityFor(route.endpoint)?.provider === route.supplier
    && (!GATED_BY_FLAG[route.supplier] || process.env[GATED_BY_FLAG[route.supplier]] === 'true');

async function main() {
    const apply = process.argv.includes('--apply');
    const noteAt = process.argv.indexOf('--note');
    const note = noteAt > 0 ? process.argv[noteAt + 1] : '';
    if (apply && (!note || note.startsWith('--') || note.length < 3)) { console.error('--apply needs --note "why" (3 or more characters)'); process.exit(2); }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || /^<.*>$/.test(cfg.serviceRoleKey)) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (silent prompt in the header, never a placeholder)'); process.exit(2); }

    const routes = await select('model_routes', { columns: 'id,model_id,supplier,endpoint,priority,state,provenance,parity_record,cost_per_unit,cost_unit,breaker_opened_at' }, cfg);
    const offers = await select('model_catalog', { columns: 'id,credits_5s', filter: 'active=eq.true' }, cfg);
    const byModel = new Map();
    for (const r of routes) (byModel.get(r.model_id) || byModel.set(r.model_id, []).get(r.model_id)).push(r);
    let changes = 0;
    for (const offer of offers) {
        const set = byModel.get(offer.id) || [];
        const p = proposeOrder({ id: offer.id, credits: offer.credits_5s, credits_5s: offer.credits_5s }, set, { canDispatch });
        if (!p.changed) continue;
        changes += 1;
        const name = (id) => { const r = set.find((x) => x.id === id); return `${r.supplier} ($${Number(r.cost_per_unit).toFixed(4)})`; };
        console.log(`${offer.id}: ${p.current.map(name).join(' > ')}  =>  ${p.proposed.map(name).join(' > ')}  saves $${p.savingPerGeneration.toFixed(4)} per generation`);
        if (apply) {
            const r = await rpc('model_route_reorder', { p_model_id: offer.id, p_route_ids: p.proposed, p_note: note }, cfg);
            console.log(r && r.ok ? '   applied' : `   REFUSED: ${r && r.code}`);
        }
    }
    console.log(changes ? (apply ? `${changes} offer(s) processed` : `${changes} proposal(s); nothing changed (dry run). Add --apply --note "why" to apply.`) : 'No offer has a cheaper dispatchable order. Nothing to do.');
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
