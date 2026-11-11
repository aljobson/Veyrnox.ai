import { readBoundedBody } from '../../../../../lib/boundedBody.js';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { musicSourcesEnabled, musicRpcStatus, validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { parseMusicSourceDelete, parseMusicSourceMutation } from '../../../../../lib/musicSources.js';
import { inspectStoredSource } from '../../../../../lib/resolveSource.js';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import {
    envConfig as r2EnvConfig,
    isConfigured as r2IsConfigured,
    presignGetUrl,
    presignPutUrl,
    deleteObject,
} from '../../../../../packages/adapters/r2.js';

const reply = (body, status = 200) => Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
});

function context(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { error: reply({ error: 'not_authenticated' }, 401) };
    if (!musicSourcesEnabled()) return { error: reply({ error: 'sources_not_open' }, 503) };
    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return { error: reply({ error: 'sources_not_configured' }, 503) };
    }
    return { authId, cfg, r2cfg };
}

async function readJson(request) {
    try {
        const bytes = await readBoundedBody(request.body, 4096, request.signal);
        return { body: JSON.parse(new TextDecoder().decode(bytes)) };
    } catch (error) {
        return { error: reply({ error: error?.status === 413 ? 'body_too_large' : 'invalid_body' }, error?.status === 413 ? 413 : 400) };
    }
}

async function project(source, r2cfg) {
    const { r2_key: key, ...safe } = source;
    if (source.status !== 'ready') return safe;
    const signed = await presignGetUrl(key, 300, r2cfg);
    return { ...safe, preview_url: signed.url, preview_expires_in: 300 };
}

export async function GET(request) {
    const ctx = context(request);
    if (ctx.error) return ctx.error;
    const limited = await accountReadLimit(ctx.authId, ctx.cfg);
    if (limited) return limited;
    try {
        const result = await rpc('music_read_sources', { p_auth_id: ctx.authId }, ctx.cfg);
        if (!result?.ok) throw new Error('source read refused');
        return reply({ sources: await Promise.all((result.sources || []).map((source) => project(source, ctx.r2cfg))) });
    } catch (error) {
        console.error('[music/sources] read failed:', error?.message);
        return reply({ error: 'sources_unavailable' }, 502);
    }
}

export async function POST(request) {
    const ctx = context(request);
    if (ctx.error) return ctx.error;
    const parsedBody = await readJson(request);
    if (parsedBody.error) return parsedBody.error;
    const parsed = parseMusicSourceMutation(parsedBody.body);
    if (!parsed.ok) return reply({ error: parsed.error }, 400);
    const limited = await socialPostWriteLimit(ctx.authId, ctx.cfg);
    if (limited) return limited;

    try {
        if (parsed.action === 'reserve') {
            const result = await rpc('music_reserve_source', {
                p_auth_id: ctx.authId,
                p_id: crypto.randomUUID(),
                p_filename: parsed.filename,
                p_mime_type: parsed.contentType,
                p_size: parsed.sizeBytes,
                p_idempotency_key: parsed.idempotencyKey,
            }, ctx.cfg);
            if (!result?.ok) return reply({ error: String(result?.code || 'SOURCE_UNAVAILABLE').toLowerCase() }, musicRpcStatus(result?.code));
            if (result.status === 'ready') {
                const existing = await rpc('music_read_sources', { p_auth_id: ctx.authId, p_id: result.id }, ctx.cfg);
                return reply({ source: await project(existing?.sources?.[0], ctx.r2cfg), idempotent: true });
            }
            const signed = await presignPutUrl(result.r2_key, parsed.contentType, 900, ctx.r2cfg, parsed.sizeBytes);
            return reply({
                id: result.id,
                upload_url: signed.url,
                content_type: signed.contentType,
                headers: signed.headers,
                idempotent: result.idempotent === true,
            }, result.idempotent ? 200 : 201);
        }

        const result = await rpc('music_read_sources', { p_auth_id: ctx.authId, p_id: parsed.id }, ctx.cfg);
        const source = result?.sources?.[0];
        if (!source) return reply({ error: 'source_not_found' }, 404);
        if (source.status === 'ready') return reply({ source: await project(source, ctx.r2cfg), idempotent: true });
        const inspected = await inspectStoredSource(source.r2_key, {
            contentType: source.mime_type,
            field: 'audio_url',
        }, ctx.r2cfg);
        if (!inspected.ok) return reply({ error: inspected.error }, 400);
        if (!Number.isFinite(inspected.seconds) || inspected.seconds <= 0) {
            return reply({ error: 'source_duration_unavailable' }, 400);
        }
        const completed = await rpc('music_complete_source', {
            p_auth_id: ctx.authId,
            p_id: parsed.id,
            p_duration_seconds: inspected.seconds,
        }, ctx.cfg);
        if (!completed?.ok) return reply({
            error: String(completed?.code || 'SOURCE_UNAVAILABLE').toLowerCase(),
            ...(completed?.max_seconds ? { max_seconds: completed.max_seconds } : {}),
        }, completed?.code === 'SOURCE_DURATION_INVALID' ? 400 : 404);
        const ready = await rpc('music_read_sources', { p_auth_id: ctx.authId, p_id: parsed.id }, ctx.cfg);
        return reply({ source: await project(ready?.sources?.[0], ctx.r2cfg), idempotent: completed.idempotent === true });
    } catch (error) {
        console.error('[music/sources] mutation failed:', error?.message);
        return reply({ error: 'sources_unavailable' }, 502);
    }
}

export async function DELETE(request) {
    const ctx = context(request);
    if (ctx.error) return ctx.error;
    const parsedBody = await readJson(request);
    if (parsedBody.error) return parsedBody.error;
    const parsed = parseMusicSourceDelete(parsedBody.body);
    if (!parsed.ok) return reply({ error: parsed.error }, 400);
    const limited = await socialPostWriteLimit(ctx.authId, ctx.cfg);
    if (limited) return limited;
    try {
        const result = await rpc('music_remove_source', { p_auth_id: ctx.authId, p_id: parsed.id }, ctx.cfg);
        if (!result?.ok) return reply({ error: 'source_not_found' }, 404);
        const removed = await deleteObject(result.r2_key, ctx.r2cfg);
        if (!removed?.ok) return reply({ error: 'source_removal_pending' }, 502);
        const finalized = await rpc('music_finalize_source_removal', {
            p_auth_id: ctx.authId,
            p_id: parsed.id,
        }, ctx.cfg);
        if (!finalized?.ok) return reply({ error: 'source_removal_pending' }, 502);
        return reply({ ok: true });
    } catch (error) {
        console.error('[music/sources] remove failed:', error?.message);
        return reply({ error: 'sources_unavailable' }, 502);
    }
}
