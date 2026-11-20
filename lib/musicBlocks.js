import { rpc, envConfig } from '../packages/db/supabase-client.js';
import { limitRequestBody } from './requestBodyLimit.js';
import { isUuidLoose } from './validate.js';
import { musicRuntimeFlag } from './musicRuntime.js';

export const musicBlocksEnabled = (env = process.env) => musicRuntimeFlag('blocks', env);
export const musicBlocksReply = (body, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '60' } : {}) },
});
const errors = { account_not_found: 403, user_not_found: 404, cannot_block_self: 400, invalid_actor_id: 400, block_limit: 409 };

export async function musicAccountReadLimit(auth, cfg, rpcCall) {
    const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, cfg);
    if (rate?.code === 'NOT_FOUND') return musicBlocksReply({ error: 'account_not_found' }, 403);
    if (rate?.code === 'RATE_LIMITED') return musicBlocksReply({ error: 'rate_limited' }, 429);
    if (rate?.ok !== true) return musicBlocksReply({ error: 'temporarily_unavailable' }, 503);
    return null;
}

/** Gateway identity only. The database owns idempotency and the 500-person cap. */
export function musicBlocksHandler({ action = 'list', rpcCall = rpc } = {}) {
    if (!['list', 'block', 'unblock'].includes(action)) throw Error('invalid blocks action');
    return async (req, ctx) => {
        const auth = req.headers.get('x-veyrnox-auth-id');
        const reply = musicBlocksReply;
        if (!isUuidLoose(auth || '')) return reply({ error: 'not_authenticated' }, 401);
        if (!musicBlocksEnabled()) return reply({ error: 'blocks_unavailable' }, 404);
        try {
            if (new URL(req.url).searchParams.size) return reply({ error: 'invalid_query' }, 400);
            let actorId;
            if (action === 'block') {
                if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'invalid_content_type' }, 415);
                const limited = await limitRequestBody(req);
                if (limited.response) return reply({ error: 'invalid_body' }, limited.response.status);
                const body = await limited.request.json().catch(() => null);
                if (!body || typeof body !== 'object' || Array.isArray(body)
                    || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'actor_id')) return reply({ error: 'invalid_body' }, 400);
                actorId = body.actor_id;
            } else if (action === 'unblock') {
                actorId = (await ctx?.params)?.actorId;
            }
            if (action !== 'list' && (typeof actorId !== 'string' || !isUuidLoose(actorId))) return reply({ error: 'invalid_actor_id' }, 400);
            if (actorId) actorId = actorId.toLowerCase();
            const cfg = envConfig();
            const limited = await musicAccountReadLimit(auth, cfg, rpcCall);
            if (limited) return limited;
            const name = action === 'list' ? 'music_list_blocked_actors' : action === 'block' ? 'music_block_actor' : 'music_unblock_actor';
            const result = await rpcCall(name, { p_auth_id: auth, ...(actorId ? { p_actor_id: actorId } : {}) }, cfg);
            if (result?.error) return reply({ error: errors[result.error] ? result.error : 'temporarily_unavailable' }, errors[result.error] || 503);
            if (action === 'list') {
                if (!Array.isArray(result?.blocks)) return reply({ error: 'temporarily_unavailable' }, 503);
                return reply({ blocks: result.blocks.filter((b) => typeof b?.actor_id === 'string' && isUuidLoose(b.actor_id)
                    && typeof b.display_name === 'string' && typeof b.created_at === 'string' && Number.isFinite(Date.parse(b.created_at)))
                    .map((b) => ({ actor_id: b.actor_id, display_name: b.display_name.slice(0, 80), created_at: b.created_at })) });
            }
            if (result?.ok !== true || typeof result.already !== 'boolean') return reply({ error: 'temporarily_unavailable' }, 503);
            return reply({ actor_id: actorId, blocked: action === 'block', already: result.already }, action === 'block' && !result.already ? 201 : 200);
        } catch {
            return reply({ error: 'temporarily_unavailable' }, 503);
        }
    };
}
