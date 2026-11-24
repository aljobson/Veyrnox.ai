import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { MUSIC_MOBILE_ROLLOUT_FLAGS, musicRuntimeFlag } from '../../../../../lib/musicRuntime.js';
import { musicDailyChallengeAt } from '../../../../../lib/musicDailyChallenge.js';
import { readFreshMusicCatalog } from '../../../../../lib/publicCatalog.js';
import {
    musicAlbumsEnabled, musicDailyCreditsEnabled, musicEntitlementProjection, musicGenerationEnabled,
    musicSchemaEnabled, validMusicAuthId,
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
        const [models, credits, subscription, crunAvailability] = await Promise.all([
            readFreshMusicCatalog({ cfg }),
            rpc('read_user_credits', { p_auth_id: authId }, cfg),
            rpc('read_own_credit_subscription', { p_auth_id: authId }, cfg),
            rpc('music_get_crun_availability', {}, cfg),
        ]);
        const dailyCredits = musicDailyCreditsEnabled();
        let dailyAllowance;
        if (dailyCredits) {
            try {
                const allowance = await rpc('music_daily_allowance_status', { p_auth_id: authId }, cfg);
                dailyAllowance = allowance?.ok ? allowance : { enabled: false, unavailable: true };
            } catch (error) {
                console.error('[music/entitlements] daily allowance unavailable:', error?.message);
                dailyAllowance = { enabled: false, unavailable: true };
            }
        }
        const features = Object.fromEntries(MUSIC_MOBILE_ROLLOUT_FLAGS.map(name => [name,
            name === 'albums' ? musicAlbumsEnabled() : musicRuntimeFlag(name)]));
        return reply({
            ...musicEntitlementProjection({
                models,
                credits,
                generationEnabled: musicGenerationEnabled(),
                longSongs: musicRuntimeFlag('longSongs'),
                subscription: subscription?.ok ? subscription.subscription : null,
                crunAvailability: crunAvailability?.ok ? crunAvailability : {
                    admission_open: false, endpoint_open: false, suno_models: {},
                },
            }),
            features,
            ...(features.dailyChallenge ? { daily_challenge: musicDailyChallengeAt() } : {}),
            ...(dailyCredits ? { daily_allowance: dailyAllowance } : {}),
        });
    } catch (error) {
        console.error('[music/entitlements] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
