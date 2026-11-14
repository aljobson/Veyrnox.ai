/**
 * GET /api/v1/chat/models — the text models a signed-in user may chat with, and what a reply costs.
 * Price is model_catalog.credits_5s ("Credits per reply", ADR-0067). Never provider_cost_per_unit,
 * never the provider endpoint (only the model family derived from it), and never the provider's name.
 */
import { select } from '../../../../../packages/db/supabase-client.js';
import { enter, reply } from '../../../../../lib/chatRoute.js';
import { MAX_REPLY_TOKENS, MAX_ATTACHMENTS, MAX_IMAGE_EDGE, makerOf, replyBudget, rowOptions, researchEnabled, selectChatModels } from '../../../../../lib/chat.js';
import { CHAT_USER_TEXT_MAX, CHAT_USER_TEXT_STANDARD_MAX } from '../../../../../lib/chatLimits.js';
import { resolveChatSearch } from '../../../../../lib/chatSearch.js';

export async function GET(req) {
    const gate = await enter(req);
    if (gate instanceof Response) return gate;
    try {
        const rows = await selectChatModels(select, {
            columns: 'id,name,provider_endpoint,credits_5s,gated_flag,chat_max_reply_tokens,chat_reasoning_effort,'
                + 'chat_thinking_effort,chat_thinking_max_reply_tokens,chat_thinking_extra_credits,chat_web_extra_credits,chat_web_engine,chat_images_extra_credits,chat_long_text_extra_credits'
                // Asked for only when research is on, so a Worker running before migration 0208 never queries the columns.
                + (researchEnabled(process.env) ? ',chat_research_extra_credits,chat_research_write_max_tokens,chat_research_search_model' : ''),
            filter: 'active=eq.true&modality=eq.text&provider=eq.openrouter-chat&id=not.like.editor-*&order=name.asc',
        }, gate.cfg);
        const searchConfigured = resolveChatSearch(process.env).provider !== 'off';
        const models = (Array.isArray(rows) ? rows : []).map((r) => ({
            id: r.id, name: r.name, maker: makerOf(r.provider_endpoint).maker, maker_label: makerOf(r.provider_endpoint).label,
            credits_per_reply: r.credits_5s, gated: !!r.gated_flag,
            max_reply_tokens: replyBudget(r).maxTokens,
            // The longest message this model takes: the full length when it offers the long-message extra, else the standard one.
            max_message_chars: rowOptions(r).long_text ? CHAT_USER_TEXT_MAX : CHAT_USER_TEXT_STANDARD_MAX,
            options: rowOptions(r, { searchConfigured }),
        }));
        return reply({ models, max_reply_tokens: MAX_REPLY_TOKENS, standard_message_chars: CHAT_USER_TEXT_STANDARD_MAX, max_attachments: MAX_ATTACHMENTS, max_image_edge: MAX_IMAGE_EDGE });
    } catch (err) {
        console.error('[chat] models failed:', err && err.message);
        return reply({ error: 'temporarily_unavailable' }, 503);
    }
}
