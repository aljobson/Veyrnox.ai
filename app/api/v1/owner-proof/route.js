import { NextResponse } from 'next/server';
import { envConfig, select } from '../../../../packages/db/supabase-client.js';
import { OWNER_PROOF_OFFERS, ownerProofEligible, ownerProofCapability } from '../../../../lib/ownerProof.js';
import { lengthsFor, publicCapabilities } from '../../../../lib/modelCapabilities.js';
import { publicModelName } from '../../../../lib/publicCatalog.js';
import { publicModelId } from '../../../../lib/publicModelIds.js';
import { veoI2vOffer } from '../../../../lib/veoI2v.js';
import { veoI2vAvailable } from '../../../../lib/veoI2vAdmission.js';

const reply = (body, status = 200) => NextResponse.json(body, {
    status, headers: { 'cache-control': 'private, no-store', vary: 'Authorization, Cookie' },
});
export async function GET(req) {
    if (!req.headers.get('x-veyrnox-auth-id')) return reply({ error: 'not_authenticated' }, 401);
    const cfg = envConfig();
    if (!await ownerProofEligible(req, cfg)) return reply({ error: 'model_not_found' }, 404);
    try {
        const rows = await select('model_catalog', {
            columns: 'id,name,modality,credits_5s,provider,provider_endpoint',
            filter: `id=in.(${OWNER_PROOF_OFFERS.join(',')})`,
        }, cfg);
        const models = [];
        for (const row of rows) {
            if (!OWNER_PROOF_OFFERS.includes(row.id)) continue;
            if (row.id.startsWith('seedance-2.5-') && (row.provider !== 'crun'
                || row.provider_endpoint !== `crun:bytedance/seedance2-5-r2v:${row.id.endsWith('-edit') ? 'edit' : 'extend'}`)) continue;
            const record = ownerProofCapability(row, true);
            if (!record || record.provider !== row.provider) continue;
            if (veoI2vOffer(row.id) && !await veoI2vAvailable(row, cfg, { ownerProof: true })) continue;
            models.push({ id: publicModelId(row.id), name: publicModelName(row.name), modality: row.modality,
                credits: row.credits_5s, gated: false, bestValue: row.provider === 'crun',
                durations: lengthsFor(record), capabilities: publicCapabilities(record) });
        }
        return reply({ models });
    } catch { return reply({ error: 'catalog_lookup_failed' }, 502); }
}
