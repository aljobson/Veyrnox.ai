import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { privacyExportEnabled, UUID_RE, exportJson as json, exportCursor, exportLedgerRow, exportPageLimit } from '../../../../../../lib/privacyExport.js';

export async function GET(req, context) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return json({ error: 'not_authenticated' }, 401);
    if (!privacyExportEnabled()) return json({ error: 'not_found' }, 404);
    const { exportId } = await context.params;
    let args;
    try {
        if (!UUID_RE.test(exportId || '')) throw new Error('invalid_request');
        args = exportCursor(new URL(req.url).searchParams);
    } catch { return json({ error: 'invalid_request' }, 400); }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'gateway_not_configured' }, 503);
    const limited = await exportPageLimit(authId, cfg);
    if (limited) return limited;
    let result;
    try {
        result = await rpc('read_privacy_export_page', {
            p_auth_id: authId, p_aal: req.headers.get('x-veyrnox-auth-aal') || 'aal1', p_export_id: exportId, ...args,
        }, cfg);
    } catch { /* never return or log database text */ }
    if (result?.ok === true) {
        return json({ rows: args.p_section === 'credit_history' ? result.rows.map(exportLedgerRow) : result.rows, next: result.next });
    }
    const status = { export_not_found: 404, export_expired: 410, mfa_required: 403, account_restricted: 403, invalid_section: 400 }[result?.error];
    if (status) return json({ error: result.error }, status);
    console.error('export_unavailable');
    return json({ error: 'export_unavailable' }, 502);
}
