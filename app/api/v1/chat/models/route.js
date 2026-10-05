/**
 * GET /api/v1/chat/models — the text models a signed-in user may chat with, and what a reply costs.
 * Price is model_catalog.credits_5s ("Credits per reply", ADR-0067). Never provider_cost_per_unit,
 * never the provider endpoint, and never the provider's name.
 */
import { select } from '../../../../../packages/db/supabase-client.js';
import { enter, reply } from '../../../../../lib/chatRoute.js';
import { MAX_REPLY_TOKENS } from '../../../../../lib/chat.js';

export async function GET(req) {
    const gate = await enter(req);
    if (gate instanceof Response) return gate;
    try {
        const rows = await select('model_catalog', {
            columns: 'id,name,credits_5s,gated_flag',
            filter: 'active=eq.true&modality=eq.text&provider=eq.openrouter-chat&order=name.asc',
        }, gate.cfg);
        const models = (Array.isArray(rows) ? rows : []).map((r) => ({
            id: r.id, name: r.name, credits_per_reply: r.credits_5s, gated: !!r.gated_flag,
        }));
        return reply({ models, max_reply_tokens: MAX_REPLY_TOKENS });
    } catch (err) {
        console.error('[chat] models failed:', err && err.message);
        return reply({ error: 'temporarily_unavailable' }, 503);
    }
}
