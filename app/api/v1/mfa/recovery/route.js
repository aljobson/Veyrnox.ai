import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { adminDeleteFactor } from '../../../../../lib/gotrueAdmin.js';
import { RECOVERY_CODE_RE, normalizeRecoveryCode, hashRecoveryCode } from '../../../../../lib/mfaRecovery.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req) {
    const userId = req.headers.get('x-veyrnox-auth-id');
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const pepper = process.env.MFA_RECOVERY_PEPPER;
    if (!pepper) return json({ error: 'recovery_not_configured' }, 503);
    const cfg = envConfig();
    try {
        // Count even malformed attempts, before parsing or consuming. Shared across isolates.
        const allowed = await rpc('mfa_recovery_attempt', { p_user_id: userId }, cfg);
        if (allowed !== true) return json({ error: 'recovery_rate_limited' }, 429);
        let body;
        try { body = await req.json(); } catch { return json({ error: 'invalid_recovery_code' }, 400); }
        const code = typeof body?.code === 'string' && RECOVERY_CODE_RE.test(body.code) ? normalizeRecoveryCode(body.code) : null;
        if (!code) return json({ error: 'invalid_recovery_code' }, 400);
        const hash = await hashRecoveryCode(code, pepper, userId);
        const result = await rpc('mfa_recovery_consume', { p_user_id: userId, p_hash: hash }, cfg);
        if (result?.consumed !== true) return json({ error: 'invalid_recovery_code' }, 400);
        if (result.stale === true || !result.factor_ids?.length) {
            return json({ recovered: false, stale: true });
        }
        // Consume first: a deletion failure burns this code, permitting retry with another.
        try {
            for (const factorId of result.factor_ids) await adminDeleteFactor(userId, factorId, cfg);
        } catch { return json({ error: 'recovery_incomplete' }, 502); }
        return json({ recovered: true });
    } catch { return json({ error: 'recovery_unavailable' }, 503); }
}
