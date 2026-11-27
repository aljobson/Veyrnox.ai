import { select } from '../packages/db/supabase-client.js';
import { resolveRouteSet } from './supplierRoutesDispatch.js';
import { veoI2vOffer, veoI2vEnabled, veoI2vMarker } from './veoI2v.js';

/** Fail closed before debit. A stored breaker of ANY age blocks CreateTask (0591). */
export async function veoI2vAvailable(row, cfg, { routeSet, ownerProof = false, read = select, env = process.env } = {}) {
    const variant = veoI2vOffer(row?.id);
    if (!variant || (!ownerProof && !veoI2vEnabled(row.id, env)) || env.CRUN_ENABLED !== 'true' || row.provider !== 'crun'
        || row.provider_endpoint !== `crun:${variant.model.replace(/-i2v$/, '-t2v')}`) return false;
    const { own, routes } = routeSet ?? await resolveRouteSet(row, cfg, { read, env });
    if (!own || own.state !== 'active' || own.supplier !== 'crun' || own.endpoint !== row.provider_endpoint
        || own.breaker_opened_at !== null || (!ownerProof && (typeof own.parity_record !== 'string'
        || !own.parity_record.includes(veoI2vMarker(variant.model))))) return false;
    // The create gate checks every stored route for the endpoint, not the ten-minute selection cooldown.
    if (routes.some(route => route.supplier === 'crun' && route.endpoint === own.endpoint && route.breaker_opened_at !== null)) return false;
    try {
        const policy = await read('provider_spend_provider_policy', { columns: 'admission_open', filter: 'provider=eq.crun', limit: 1 }, cfg);
        return policy?.[0]?.admission_open === true;
    } catch { return false; }
}
