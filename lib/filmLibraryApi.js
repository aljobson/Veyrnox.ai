import { rpc, envConfig } from '../packages/db/supabase-client.js';
import { presignGetUrl, envConfig as r2EnvConfig, isConfigured } from '../packages/adapters/r2.js';
import { assetDownloadName } from './assetDownloadName.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const limited = row => row?.ok === false && row.code === 'RATE_LIMITED';
const rateResponse = row => {
    const seconds = Number.isInteger(row.retry_after_seconds) ? Math.max(1, Math.min(60, row.retry_after_seconds)) : 60;
    return reply({ error: 'rate_limited', retry_after_seconds: seconds }, 429, { 'Retry-After': String(seconds) });
};
export function filmLibraryHandlers({ enabled = process.env.FILM_LIBRARY_MASTERS_ENABLED === 'true', cfg = envConfig(), r2cfg = r2EnvConfig(), call = rpc, sign = presignGetUrl } = {}) {
    async function list(req) {
        const authId = req.headers.get('x-veyrnox-auth-id');
        if (!authId) return reply({ error: 'not_authenticated' }, 401);
        if (!enabled) return reply({ enabled: false, masters: [] });
        if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'not_configured' }, 503);
        try {
            const row = await call('list_film_library_masters', { p_auth_id: authId }, cfg);
            if (limited(row)) return rateResponse(row);
            if (row?.ok !== true || !Array.isArray(row.masters)) return reply({ error: 'library_unavailable' }, 503);
            return reply({ enabled: true, masters: row.masters });
        } catch { return reply({ error: 'library_unavailable' }, 503); }
    }
    async function asset(req, id) {
        const authId = req.headers.get('x-veyrnox-auth-id');
        if (!authId) return reply({ error: 'not_authenticated' }, 401);
        if (!enabled) return reply({ error: 'not_found' }, 404);
        if (!UUID.test(id || '')) return reply({ error: 'invalid_id' }, 400);
        const download = new URL(req.url).searchParams.getAll('download');
        if (download.length > 1 || (download.length === 1 && download[0] !== '1')) return reply({ error: 'invalid_download' }, 400);
        if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(r2cfg)) return reply({ error: 'not_configured' }, 503);
        try {
            const rate = await call('consume_asset_link_request', { p_auth_id: authId }, cfg);
            if (limited(rate)) return rateResponse(rate);
            if (rate?.ok !== true) return reply({ error: rate?.code === 'NOT_FOUND' ? 'not_found' : 'rate_limit_unavailable' }, rate?.code === 'NOT_FOUND' ? 404 : 503);
            const row = await call('get_film_library_master', { p_auth_id: authId, p_id: id }, cfg);
            if (row?.ok !== true) return reply({ error: 'not_found' }, 404);
            const signed = await sign(row.r2_key, 900, r2cfg, download.length ? { downloadFilename: assetDownloadName(id, 'video/mp4') } : undefined);
            return reply({ url: signed.url, mime_type: 'video/mp4', size_bytes: row.size_bytes, sha256: row.sha256, expires_in: signed.expires, asset_expires_at: row.expires_at });
        } catch { return reply({ error: 'asset_unavailable' }, 503); }
    }
    return { list, asset };
}
