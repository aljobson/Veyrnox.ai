import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import {
    musicReferencesEnabled,
    readMusicJson,
    validMusicAuthId,
} from '../../../../../lib/musicBackend.js';
import {
    parseMusicReferenceCreate,
    parseMusicReferenceDelete,
    resolveMusicReference,
} from '../../../../../lib/musicReferenceLinks.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { envConfig, rpc } from '../../../../../packages/db/supabase-client.js';

const reply = (body, status = 200) => Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
});

function context(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { error: reply({ error: 'not_authenticated' }, 401) };
    if (!musicReferencesEnabled()) return { error: reply({ error: 'references_not_open' }, 503) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return { error: reply({ error: 'references_not_configured' }, 503) };
    }
    return { authId, cfg };
}

function resolutionStatus(error) {
    if (error === 'reference_not_found') return 404;
    if (error === 'reference_not_embeddable') return 422;
    if (error === 'reference_upstream_rate_limited') return 503;
    if (error === 'reference_upstream_timeout') return 504;
    if (error === 'reference_upstream_unavailable') return 502;
    if (error === 'reference_metadata_invalid') return 422;
    return 400;
}

export async function GET(request) {
    const ctx = context(request);
    if (ctx.error) return ctx.error;
    const limited = await accountReadLimit(ctx.authId, ctx.cfg, { links: [] });
    if (limited) return limited;
    try {
        const result = await rpc('music_list_reference_links', { p_auth_id: ctx.authId }, ctx.cfg);
        if (!result?.ok && result?.code === 'NOT_FOUND') return reply({ links: [] });
        if (!result?.ok) return reply({ error: 'references_unavailable' }, 502);
        return reply({ links: Array.isArray(result.links) ? result.links : [] });
    } catch (error) {
        console.error('[music/reference-links] read failed:', error?.message);
        return reply({ error: 'references_unavailable' }, 502);
    }
}

export async function POST(request) {
    const ctx = context(request);
    if (ctx.error) return ctx.error;
    const parsedBody = await readMusicJson(request);
    if (!parsedBody.ok) return reply({ error: parsedBody.error }, 400);
    const parsed = parseMusicReferenceCreate(parsedBody.value);
    if (!parsed.ok) return reply({ error: parsed.error }, 400);
    let replay;
    try {
        replay = await rpc('music_get_reference_link_by_idempotency', {
            p_auth_id: ctx.authId,
            p_idempotency_key: parsed.idempotencyKey,
        }, ctx.cfg);
    } catch (error) {
        console.error('[music/reference-links] replay lookup failed:', error?.message);
        return reply({ error: 'references_unavailable' }, 502);
    }
    if (!replay?.ok) {
        return replay?.code === 'NOT_FOUND'
            ? reply({ error: 'account_not_found' }, 404)
            : reply({ error: 'references_unavailable' }, 502);
    }
    if (replay.found) {
        const matches = replay.link?.provider === parsed.provider
            && replay.link?.external_id === parsed.externalId
            && replay.link?.rights_mode === parsed.rightsMode;
        return matches
            ? reply({ link: replay.link, idempotent: true })
            : reply({ error: 'idempotency_conflict' }, 409);
    }

    const limited = await socialPostWriteLimit(ctx.authId, ctx.cfg);
    if (limited) return limited;

    const resolved = await resolveMusicReference(parsed, { signal: request.signal });
    if (!resolved.ok) return reply({ error: resolved.error }, resolutionStatus(resolved.error));

    try {
        const result = await rpc('music_create_reference_link', {
            p_auth_id: ctx.authId,
            p_id: crypto.randomUUID(),
            p_provider: resolved.provider,
            p_external_id: resolved.externalId,
            p_canonical_url: resolved.canonicalUrl,
            p_title: resolved.title,
            p_creator: resolved.creator,
            p_thumbnail_url: resolved.thumbnailUrl,
            p_embed_url: resolved.embedUrl,
            p_rights_mode: parsed.rightsMode,
            p_idempotency_key: parsed.idempotencyKey,
        }, ctx.cfg);
        if (!result?.ok) {
            const error = String(result?.code || 'REFERENCES_UNAVAILABLE').toLowerCase();
            const status = ['already_saved', 'idempotency_conflict', 'reference_limit_reached'].includes(error)
                ? 409
                : error === 'not_found' ? 404 : 502;
            if (error === 'not_found') return reply({ error: 'account_not_found' }, status);
            return reply({ error }, status);
        }
        return reply({ link: result.link, idempotent: result.idempotent === true }, result.idempotent ? 200 : 201);
    } catch (error) {
        console.error('[music/reference-links] create failed:', error?.message);
        return reply({ error: 'references_unavailable' }, 502);
    }
}

export async function DELETE(request) {
    const ctx = context(request);
    if (ctx.error) return ctx.error;
    const parsedBody = await readMusicJson(request);
    if (!parsedBody.ok) return reply({ error: parsedBody.error }, 400);
    const parsed = parseMusicReferenceDelete(parsedBody.value);
    if (!parsed.ok) return reply({ error: parsed.error }, 400);
    const limited = await socialPostWriteLimit(ctx.authId, ctx.cfg);
    if (limited) return limited;
    try {
        const result = await rpc('music_delete_reference_link', {
            p_auth_id: ctx.authId,
            p_id: parsed.id,
        }, ctx.cfg);
        if (!result?.ok) return reply({ error: 'reference_not_found' }, 404);
        return reply({ ok: true });
    } catch (error) {
        console.error('[music/reference-links] delete failed:', error?.message);
        return reply({ error: 'references_unavailable' }, 502);
    }
}
