import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { privacyExportEnabled, EXPORT_SECTIONS, UUID_RE, exportJson as json } from '../../../../../lib/privacyExport.js';

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return json({ error: 'not_authenticated' }, 401);
    if (!privacyExportEnabled()) return json({ error: 'not_found' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'gateway_not_configured' }, 503);
    let result;
    try {
        result = await rpc('start_privacy_export', { p_auth_id: authId, p_aal: req.headers.get('x-veyrnox-auth-aal') || 'aal1' }, cfg);
    } catch { /* typed response below; never log upstream text */ }
    if (result?.ok === true) {
        const { export_id, as_of, expires_at, resumed } = result;
        return json({ export_id, as_of, expires_at, resumed, sections: EXPORT_SECTIONS });
    }
    if (result?.error === 'rate_limited') {
        const retry = Number.isInteger(result.retry_after_seconds) ? Math.max(1, Math.min(86400, result.retry_after_seconds)) : 86400;
        return json({ error: 'rate_limited', retry_after_seconds: retry }, 429, { 'Retry-After': String(retry) });
    }
    const status = { mfa_required: 403, account_restricted: 403, account_not_found: 404 }[result?.error];
    if (status) return json({ error: result.error }, status);
    console.error('export_unavailable');
    return json({ error: 'export_unavailable' }, 502);
}
