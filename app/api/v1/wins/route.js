import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { yourWinsEnabled, winsProjection } from '../../../../lib/yourWins.js';
import { accountReadLimit } from '../../../../lib/accountReadLimit.js';
import { isUuidLoose } from '../../../../lib/validate.js';
import { isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../packages/adapters/r2.js';
import { defaultDeps } from '../../../../lib/clipEditSources.js';
import { measureNewVideos } from '../../../../lib/yourWinsVideoLengths.js';
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !isUuidLoose(authId)) return json({ error: 'not_authenticated' }, 401);
    if (!yourWinsEnabled(process.env)) return json({ error: 'not_found' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'wins_unavailable' }, 502);
    try {
        const rate = await accountReadLimit(authId, cfg, { error: 'account_unavailable' });
        if (rate) return rate.status === 200 ? json({ error: 'account_unavailable' }, 403) : rate;
        const r2cfg = r2EnvConfig();
        // Best effort: a failed measurement leaves the old rule for that video, never a failed page.
        if (r2IsConfigured(r2cfg)) await measureNewVideos(authId, { rpc: (name, body) => rpc(name, body, cfg), mp4: defaultDeps(cfg, r2cfg).mp4 })
            .catch(() => console.error('[wins] video lengths unavailable'));
        const result = await rpc('read_your_wins', { p_auth_id: authId }, cfg);
        if (result?.ok === true) return json(winsProjection(result, process.env));
        if (result?.code === 'ACCOUNT_UNAVAILABLE') return json({ error: 'account_unavailable' }, 403);
    } catch { /* Never log upstream payloads. */ }
    console.error('[wins] request failed');
    return json({ error: 'wins_unavailable' }, 502);
}
