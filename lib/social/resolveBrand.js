// The caller's default Publish brand, or a ready NextResponse error.
// Shared by the /api/v1/social posts and drafts routes.
import { NextResponse } from 'next/server';
import { rpc, SupabaseError } from '../../packages/db/supabase-client.js';

export async function resolveBrand(authId, cfg, routeTag) {
    try {
        const brand = await rpc('get_or_create_default_social_brand', { p_auth_id: authId }, cfg);
        if (!brand || brand.ok !== true) {
            const code = brand && brand.code === 'USER_NOT_FOUND' ? 'not_authenticated' : 'internal';
            return { error: NextResponse.json({ error: code }, { status: code === 'not_authenticated' ? 401 : 502 }) };
        }
        return { brandId: brand.brand_id };
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error(`[${routeTag}] brand lookup failed:`, status, err && err.body);
        return { error: NextResponse.json({ error: 'internal' }, { status: 502 }) };
    }
}
