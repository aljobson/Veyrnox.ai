import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { adminListUserFactors } from '../../../../../../lib/gotrueAdmin.js';
import { generateRecoveryCodes, normalizeRecoveryCode, hashRecoveryCode } from '../../../../../../lib/mfaRecovery.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function gate(req, fresh = false) {
    if (!req.headers.get('x-veyrnox-auth-id')) return json({ error: 'unauthorized' }, 401);
    if (req.headers.get('x-veyrnox-auth-aal') !== 'aal2') return json({ error: 'reauth_required' }, 403);
    if (fresh) {
        // Same server-side freshness window and clock skew as admin/users/ledger.
        const rawMfa = req.headers.get('x-veyrnox-auth-mfa-at');
        const mfaAt = rawMfa && /^\d+$/.test(rawMfa) ? Number(rawMfa) : NaN;
        const nowSec = Math.floor(Date.now() / 1000);
        if (!Number.isSafeInteger(mfaAt) || mfaAt < nowSec - 300 || mfaAt > nowSec + 5) return json({ error: 'reauth_required' }, 403);
    }
    if (!process.env.MFA_RECOVERY_PEPPER) return json({ error: 'recovery_not_configured' }, 503);
    return null;
}

export async function GET(req) {
    const denied = gate(req);
    if (denied) return denied;
    try {
        return json(await rpc('mfa_recovery_status', { p_user_id: req.headers.get('x-veyrnox-auth-id') }, envConfig()));
    } catch { return json({ error: 'recovery_unavailable' }, 503); }
}

export async function POST(req) {
    const denied = gate(req, true);
    if (denied) return denied;
    const userId = req.headers.get('x-veyrnox-auth-id');
    const cfg = envConfig();
    try {
        const factors = await adminListUserFactors(userId, cfg);
        if (!factors.length) return json({ error: 'reauth_required' }, 403);
        const codes = generateRecoveryCodes();
        const hashes = await Promise.all(codes.map(code => hashRecoveryCode(normalizeRecoveryCode(code), process.env.MFA_RECOVERY_PEPPER, userId)));
        const batch = crypto.randomUUID();
        const count = await rpc('mfa_recovery_replace', { p_user_id: userId, p_hashes: hashes, p_batch: batch, p_factor_ids: factors.map(f => f.id) }, cfg);
        if (count !== codes.length) return json({ error: 'recovery_unavailable' }, 503);
        return json({ codes, batch_id: batch });
    } catch { return json({ error: 'recovery_unavailable' }, 503); }
}
