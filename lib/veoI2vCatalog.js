import { select } from '../packages/db/supabase-client.js';
import { chooseRoute } from './supplierRoutes.js';
import { routesEnabled } from './supplierRoutesDispatch.js';
import { VEO_I2V, veoI2vEnabled } from './veoI2v.js';
import { veoI2vAvailable } from './veoI2vAdmission.js';

export const VEO_I2V_CATALOG_TTL_SECONDS = 20;
export const VEO_I2V_CATALOG_READ_TIMEOUT_MS = 1500;
const IDS = Object.keys(VEO_I2V);
// Include the catalog identity in the route read so a stale price cache cannot authorize the wrong supplier.
const COLUMNS = 'model_id,id,supplier,endpoint,priority,state,provenance,parity_record,breaker_opened_at,offer:model_catalog!inner(id,active,provider,provider_endpoint)';
let snapshot;
export function _resetVeoI2vCatalog() { snapshot = undefined; }

/** Discovery only. Cache settled data, never I/O owned by another Worker request. */
export async function readVeoI2vCatalog(cfg, { read = select, env = process.env } = {}) {
    const flags = { APP_RUNTIME_FLAGS: env.APP_RUNTIME_FLAGS, CRUN_ENABLED: env.CRUN_ENABLED, SUPPLIER_ROUTES_ENABLED: env.SUPPLIER_ROUTES_ENABLED };
    const enabled = IDS.filter(id => veoI2vEnabled(id, flags));
    const key = JSON.stringify([cfg.supabaseUrl, enabled, flags.CRUN_ENABLED, routesEnabled(flags)]);
    if (!enabled.length || flags.CRUN_ENABLED !== 'true' || !routesEnabled(flags)) return {};
    if (snapshot?.key === key && snapshot.read === read && Date.now() < snapshot.expiresAt) return snapshot.value;
    const work = (async () => {
        try {
            const [rows, policy] = await Promise.all([
                read('model_routes', { columns: COLUMNS, filter: `model_id=in.(${IDS.join(',')})` }, cfg),
                read('provider_spend_provider_policy', { columns: 'admission_open', filter: 'provider=eq.crun', limit: 1 }, cfg),
            ]);
            if (!Array.isArray(rows) || policy?.[0]?.admission_open !== true) return {};
            const admitted = {};
            for (const id of enabled) {
                const routes = rows.filter(route => route.model_id === id);
                const row = routes[0]?.offer;
                if (row?.id !== id || row.active !== true) continue;
                const [own] = chooseRoute(routes);
                if (await veoI2vAvailable(row, cfg, { routeSet: { own, routes }, read: async () => policy, env: flags })) {
                    admitted[id] = row.provider_endpoint;
                }
            }
            return admitted;
        } catch { return {}; }
    })();
    // A cancelled request may abandon its I/O. Every miss owns its reads and deadline;
    // a timeout settles empty and late I/O cannot publish an enabled snapshot.
    let timer;
    try {
        const value = await Promise.race([work, new Promise(resolve => {
            timer = setTimeout(() => resolve({}), VEO_I2V_CATALOG_READ_TIMEOUT_MS);
        })]);
        snapshot = { key, read, expiresAt: Date.now() + VEO_I2V_CATALOG_TTL_SECONDS * 1000, value };
        return value;
    } finally { clearTimeout(timer); }
}
