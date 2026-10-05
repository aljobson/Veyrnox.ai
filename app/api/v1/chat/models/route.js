/**
 * GET /api/v1/chat/models — the text models a signed-in user may chat with, and what a reply costs.
 * Price is model_catalog.credits_5s ("Credits per reply", ADR-0067). Never provider_cost_per_unit,
 * never the provider endpoint (only the model family derived from it), and never the provider's name.
 */
import { select } from '../../../../../packages/db/supabase-client.js';
import { enter, reply } from '../../../../../lib/chatRoute.js';
import { MAX_REPLY_TOKENS, MAX_ATTACHMENTS, MAX_IMAGE_EDGE, makerOf, replyBudget, rowOptions, researchEnabled, searchApiKey, selectChatModels } from '../../../../../lib/chat.js';

export async function GET(req) {
    const gate = await enter(req);
    if (gate instanceof Response) return gate;
    try {
        const rows = await selectChatModels(select, {
            columns: 'id,name,provider_endpoint,credits_5s,gated_flag,chat_max_reply_tokens,chat_reasoning_effort,'
                + 'chat_thinking_effort,chat_thinking_max_reply_tokens,chat_thinking_extra_credits,chat_web_extra_credits,chat_web_engine,chat_images_extra_credits'
                // Asked for only when research is on, so a Worker running before migration 0208 never queries the columns.
                + (researchEnabled(process.env) ? ',chat_research_extra_credits,chat_research_write_max_tokens' : ''),
            filter: 'active=eq.true&modality=eq.text&provider=eq.openrouter-chat&order=name.asc',
        }, gate.cfg);
        const searchConfigured = searchApiKey(process.env) !== '';
        const models = (Array.isArray(rows) ? rows : []).map((r) => ({
            id: r.id, name: r.name, maker: makerOf(r.provider_endpoint).maker, maker_label: makerOf(r.provider_endpoint).label,
            credits_per_reply: r.credits_5s, gated: !!r.gated_flag,
            max_reply_tokens: replyBudget(r).maxTokens,
            options: rowOptions(r, { searchConfigured }),
        }));
        return reply({ models, max_reply_tokens: MAX_REPLY_TOKENS, max_attachments: MAX_ATTACHMENTS, max_image_edge: MAX_IMAGE_EDGE });
    } catch (err) {
        console.error('[chat] models failed:', err && err.message);
        return reply({ error: 'temporarily_unavailable' }, 503);
    }
}
