import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { presignGetUrl, isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../../../packages/adapters/r2.js';
import { assetDownloadName } from '../../../../../../lib/assetDownloadName.js';
import { musicDistributionEnabled, musicRpcStatus, publicMusicError, validMusicAuthId } from '../../../../../../lib/musicBackend.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOWNLOAD_TTL_SECONDS = 300;
const FORMAT_MIME_TYPES = Object.freeze({
    mp3: new Set(['audio/mpeg', 'audio/mp3']),
    wav: new Set(['audio/wav', 'audio/x-wav', 'audio/wave']),
});
const CANONICAL_MIME_TYPES = Object.freeze({ mp3: 'audio/mpeg', wav: 'audio/wav' });
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicDistributionEnabled()) return reply({ error: 'music_distribution_unavailable' }, 404);
    const { id } = await params;
    if (!UUID_RE.test(id || '')) return reply({ error: 'export_id_invalid' }, 400);
    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return reply({ error: 'gateway_not_configured' }, 503);
    }
    try {
        const result = await rpc('music_get_export', { p_auth_id: authId, p_export_id: id }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        const item = result.export;
        const format = String(item?.format || '').toLowerCase();
        const mimeType = String(item?.mime_type || '').toLowerCase();
        if (item?.state !== 'ready' || !FORMAT_MIME_TYPES[format]?.has(mimeType)) {
            return reply({ error: 'format_unavailable' }, 503);
        }
        const canonicalMimeType = CANONICAL_MIME_TYPES[format];
        const signed = await presignGetUrl(item.r2_key, DOWNLOAD_TTL_SECONDS, r2cfg, {
            downloadFilename: assetDownloadName(item.job_id, canonicalMimeType),
        });
        return reply({ export: {
            id: item.id, state: item.state, url: signed.url,
            format, mime_type: canonicalMimeType, size_bytes: item.size_bytes, expires_in: signed.expires,
        } });
    } catch (error) {
        console.error('[music/exports] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
