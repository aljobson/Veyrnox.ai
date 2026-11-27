import { select } from '../packages/db/supabase-client.js';
import { appRuntimeFlag } from './appRuntime.js';
import { capabilityFor } from './modelCapabilities.js';
import { veoI2vOffer, VEO_IMAGE_SLOT } from './veoI2v.js';

export const OWNER_PROOF_OFFERS = Object.freeze([
    'seedance-2.5-edit', 'seedance-2.5-extend',
    'veo-3.1-lite-kie', 'veo-3.1-fast-kie', 'veo-3.1-kie',
]);

// Identity and assurance are set by middleware after stripping incoming headers.
// Never cache the database role: revocation takes effect on the next request.
export function ownerProofCandidate(req, { modelId, env = process.env } = {}) {
    // OAuth clients must never inherit the website owner's private proof access.
    // Middleware forwards an empty string for first-party sessions.
    return !req.headers.get('x-veyrnox-auth-client-id') && appRuntimeFlag('ownerProof', env)
        && (modelId === undefined || OWNER_PROOF_OFFERS.includes(modelId))
        && !!req.headers.get('x-veyrnox-auth-id') && req.headers.get('x-veyrnox-auth-aal') === 'aal2';
}

export async function ownerProofEligible(req, cfg, options = {}) {
    if (!ownerProofCandidate(req, options)) return false;
    const { read = select } = options;
    const authId = req.headers.get('x-veyrnox-auth-id');
    try {
        const rows = await read('users', { columns: 'is_admin', filter: `auth_id=eq.${encodeURIComponent(authId)}`, limit: 1 }, cfg);
        return Array.isArray(rows) && rows.length === 1 && rows[0]?.is_admin === true;
    } catch { return false; }
}

export function ownerProofCapability(row, eligible) {
    const record = capabilityFor(row.provider_endpoint);
    const variant = veoI2vOffer(row.id);
    if (!eligible || !record || !variant || row.provider !== 'crun'
        || row.provider_endpoint !== `crun:${variant.model.replace(/-i2v$/, '-t2v')}`) return record;
    return { ...record, media: { ...record.media, image: { ...VEO_IMAGE_SLOT } } };
}
