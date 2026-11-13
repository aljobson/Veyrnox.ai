import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import {
    musicGenerationEnabled, musicPromptPolicy, musicRpcStatus, parseMusicQuote, publicMusicError,
    readMusicJson, validMusicAuthId,
} from '../../../../../lib/musicBackend.js';

const reply = (body, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store' },
});

/** Exact, short-lived quote for two independently refundable candidates. */
export async function POST(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicGenerationEnabled()) return reply({ error: 'music_unavailable' }, 404);

    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicQuote(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    let policyInput = input.prompt;
    let customDraft = null;
    if (input.mode === 'custom') {
        try {
            const draftResult = await rpc('music_get_custom_draft', { p_auth_id: authId }, cfg);
            customDraft = draftResult?.draft;
        } catch (error) {
            console.error('[music/quotes] custom draft read failed:', error?.message);
            return reply({ error: 'temporarily_unavailable' }, 502);
        }
        if (!customDraft || customDraft.revision !== input.draftRevision) {
            return reply({ error: 'revision_conflict' }, 409);
        }
        policyInput = input.instrumental
            ? customDraft.styles || ''
            : `${customDraft.styles || ''}\n${customDraft.lyrics || ''}`;
    }
    const policy = musicPromptPolicy(policyInput);
    if (!policy.ok) return reply({ error: policy.error, policy_version: policy.version }, 400);

    let result;
    try {
        result = input.mode === 'custom'
            ? await rpc('music_create_custom_quote', {
                p_auth_id: authId,
                p_draft_revision: input.draftRevision,
                p_instrumental: input.instrumental,
                p_rights_confirmed: input.rightsConfirmed,
                p_duration_seconds: input.durationSeconds,
            }, cfg)
            : await rpc('music_create_quote', {
                p_auth_id: authId,
                p_prompt: input.prompt,
                p_title: input.title,
                p_model_id: input.modelId,
                p_variety: input.variety,
                p_style_influence: input.styleInfluence,
                p_exclude_styles: input.excludeStyles,
                p_duration_seconds: input.durationSeconds,
            }, cfg);
    } catch (error) {
        console.error('[music/quotes] rpc failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
    if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
    return reply({
        quote_id: result.quote_id,
        mode: input.mode,
        model_id: result.model_id,
        output_count: 2,
        credits_per_candidate: result.unit_credits,
        total_credits: result.total_credits,
        balance: result.balance,
        balance_after: result.balance_after,
        affordable: result.affordable === true,
        expires_at: result.expires_at,
        policy_version: policy.version,
    }, 201);
}
