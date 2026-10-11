import { NextResponse } from 'next/server';
import { rpc } from '../../../../../../packages/db/supabase-client.js';
import { presignGetUrl, envConfig as r2EnvConfig, isConfigured } from '../../../../../../packages/adapters/r2.js';
import { adminGate, rpcFailure, rpcRefusal, UUID_RE, NO_STORE } from '../../../../../../lib/adminGate.js';

export async function GET(req) {
    const g = await adminGate(req);
    if (g.response) return g.response;
    const jobId = new URL(req.url).searchParams.get('job_id');
    if (!jobId || !UUID_RE.test(jobId)) return NextResponse.json({ error: 'job_id_invalid' }, { status: 400, headers: NO_STORE });
    const r2cfg = r2EnvConfig();
    if (!isConfigured(r2cfg)) return NextResponse.json({ error: 'storage_not_configured' }, { status: 503, headers: NO_STORE });
    let result;
    try { result = await rpc('admin_held_asset', { p_auth_id: g.authId, p_job_id: jobId }, g.cfg); }
    catch (err) { return rpcFailure(err, 'admin/reports/asset'); }
    if (!result?.ok) return rpcRefusal(result, 'asset_unavailable', ['not_found']);
    try {
        const { url } = await presignGetUrl(result.r2_key, 300, r2cfg);
        return NextResponse.json({ url, mime_type: result.mime_type, expires_in: 300 }, { headers: NO_STORE });
    } catch { return NextResponse.json({ error: 'internal' }, { status: 502, headers: NO_STORE }); }
}
