// The caller's default Publish brand, or a ready NextResponse error.
// Shared by the /api/v1/social posts and drafts routes.
import { NextResponse } from 'next/server';
import { rpc, SupabaseError } from '../../packages/db/supabase-client.js';
import { socialTeamsEnabled } from './publishFeature.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveBrand(authId, cfg, routeTag, { request, allowedRoles = ['owner'] } = {}) {
    try {
        const selected = socialTeamsEnabled() ? request?.headers?.get('x-publish-brand-id') : null;
        if (selected) {
            if (!UUID.test(selected)) {
                return { error: NextResponse.json({ error: 'invalid_brand_id' }, { status: 400 }) };
            }
            const access = await rpc('get_social_brand_access', { p_auth_id: authId, p_brand_id: selected }, cfg);
            if (!access?.ok) {
                const status = access?.code === 'USER_NOT_FOUND' ? 401 : 404;
                return { error: NextResponse.json({ error: String(access?.code || 'brand_not_found').toLowerCase() }, { status }) };
            }
            if (!allowedRoles.includes(access.role)) {
                return { error: NextResponse.json({ error: 'brand_role_forbidden', role: access.role }, { status: 403 }) };
            }
            return {
                brandId: access.brand_id,
                brandLabel: access.label,
                role: access.role,
                paid: access.paid === true,
                selected: true,
                // Legacy read RPCs authorize the owning identity. The route
                // has already verified the acting member and selected brand.
                rpcAuthId: access.owner_auth_id,
            };
        }
        const brand = await rpc('get_or_create_default_social_brand', { p_auth_id: authId }, cfg);
        if (!brand || brand.ok !== true) {
            const code = brand && brand.code === 'USER_NOT_FOUND' ? 'not_authenticated' : 'internal';
            return { error: NextResponse.json({ error: code }, { status: code === 'not_authenticated' ? 401 : 502 }) };
        }
        return { brandId: brand.brand_id, brandLabel: brand.label, role: 'owner', rpcAuthId: authId, selected: false };
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error(`[${routeTag}] brand lookup failed:`, status, err && err.body);
        return { error: NextResponse.json({ error: 'internal' }, { status: 502 }) };
    }
}
