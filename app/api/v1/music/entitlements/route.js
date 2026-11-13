import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { readPublicCatalog } from '../../../../../lib/publicCatalog.js';
import {
    musicEntitlementProjection, musicGenerationEnabled, musicSchemaEnabled, validMusicAuthId,
} from '../../../../../lib/musicBackend.js';

const reply = (body, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store' },
});

/** Authenticated create-screen contract: spendable balance plus verified music models. */
export async function GET(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicSchemaEnabled()) return reply({ error: 'music_unavailable' }, 404);

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const [models, credits, subscription] = await Promise.all([
            readPublicCatalog({ cfg }),
            rpc('read_user_credits', { p_auth_id: authId }, cfg),
            rpc('read_own_credit_subscription', { p_auth_id: authId }, cfg),
        ]);
        return reply(musicEntitlementProjection({
            models,
            credits,
            generationEnabled: musicGenerationEnabled(),
            subscription: subscription?.ok ? subscription.subscription : null,
        }));
    } catch (error) {
        console.error('[music/entitlements] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
