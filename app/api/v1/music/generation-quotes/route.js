import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicRuntimeFlag } from '../../../../../lib/musicRuntime.js';
import { readFreshMusicCatalog } from '../../../../../lib/publicCatalog.js';
import {
    MUSIC_BEAT_MODEL_ID, MUSIC_CRUN_CONTRACT, MUSIC_CRUN_JSON_MAX_BYTES, MUSIC_MODEL_IDS,
    musicBeatAiEnabled, musicDailyCreditsEnabled, musicGenerationEnabled, musicPromptPolicy, musicRpcStatus,
    parseMusicQuote, publicMusicError,
    readMusicJson, validMusicAuthId,
} from '../../../../../lib/musicBackend.js';

const reply = (body, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store' },
});

/** Exact, short-lived quote for one independently refundable track. */
export async function POST(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicGenerationEnabled()) return reply({ error: 'music_unavailable' }, 404);

    const decoded = await readMusicJson(request, MUSIC_CRUN_JSON_MAX_BYTES);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    // Gate before parsing: the incomplete phone probe must never create a quote.
    if (decoded.value && typeof decoded.value === 'object' && !Array.isArray(decoded.value)
        && decoded.value.model_id === MUSIC_BEAT_MODEL_ID && !musicBeatAiEnabled()) {
        return reply({ error: 'beat_ai_unavailable' }, 404);
    }
    const requestedModel = decoded.value?.mode === 'custom'
        ? 'ace-step-1.5' : decoded.value?.model_id ?? 'ace-step';
    if (requestedModel !== MUSIC_BEAT_MODEL_ID && !MUSIC_MODEL_IDS.includes(requestedModel)) {
        return reply({ error: 'model_not_supported' }, 400);
    }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    let providerContract;
    if (requestedModel !== MUSIC_BEAT_MODEL_ID) {
        try {
            const catalog = await readFreshMusicCatalog({ cfg });
            providerContract = catalog.find((model) => model.id === requestedModel)?.provider_contract;
        } catch (error) {
            console.error('[music/quotes] fresh catalog read failed:', error?.message);
            return reply({ error: 'temporarily_unavailable' }, 502);
        }
        if (!providerContract) return reply({ error: 'model_unavailable' }, 503);
        if (decoded.value?.provider_contract !== undefined
            && decoded.value.provider_contract !== providerContract) {
            return reply({ error: 'contract_stale' }, 409);
        }
    }
    const input = requestedModel === MUSIC_BEAT_MODEL_ID
        ? parseMusicQuote(decoded.value, { longSongs: musicRuntimeFlag('longSongs') })
        : parseMusicQuote(decoded.value, { longSongs: musicRuntimeFlag('longSongs'), providerContract });
    if (!input.ok) return reply({ error: input.error }, 400);
    let policyInput = input.prompt;
    let customDraft = null;
    if (input.mode === 'custom') {
        try {
            const draftResult = await rpc('music_get_custom_draft', {
                p_auth_id: authId,
                ...(providerContract ? { p_provider_contract: providerContract } : {}),
            }, cfg);
            if (!draftResult?.ok) {
                return reply({ error: publicMusicError(draftResult?.code) }, musicRpcStatus(draftResult?.code));
            }
            customDraft = draftResult?.draft;
        } catch (error) {
            console.error('[music/quotes] custom draft read failed:', error?.message);
            return reply({ error: 'temporarily_unavailable' }, 502);
        }
        if (!customDraft || customDraft.revision !== input.draftRevision
            || (input.draftId && customDraft.id !== input.draftId)) {
            return reply({ error: 'revision_conflict' }, 409);
        }
        if (providerContract === MUSIC_CRUN_CONTRACT && !input.instrumental
            && !(typeof customDraft.lyrics === 'string' && customDraft.lyrics.trim())) {
            return reply({ error: 'lyrics_required' }, 400);
        }
        policyInput = input.instrumental
            ? customDraft.styles || ''
            : `${customDraft.styles || ''}\n${customDraft.lyrics || ''}`;
    }
    const policy = musicPromptPolicy(policyInput);
    if (!policy.ok) return reply({ error: policy.error, policy_version: policy.version }, 400);

    const allowanceCapable = musicDailyCreditsEnabled() && input.dailyAllowanceCapable === true
        && providerContract === MUSIC_CRUN_CONTRACT && requestedModel !== MUSIC_BEAT_MODEL_ID;
    let result;
    try {
        result = input.mode === 'custom'
            ? await rpc(allowanceCapable ? 'music_create_custom_quote_with_daily_allowance' : 'music_create_custom_quote', {
                p_auth_id: authId,
                ...(providerContract ? {
                    p_provider_contract: providerContract,
                    p_draft_id: input.draftId ?? customDraft.id,
                } : {}),
                p_draft_revision: input.draftRevision,
                p_instrumental: input.instrumental,
                p_rights_confirmed: input.rightsConfirmed,
                p_duration_seconds: input.durationSeconds,
                ...(providerContract === MUSIC_CRUN_CONTRACT ? {
                    p_suno_model: input.sunoModel,
                    p_vocal_gender: input.vocalGender,
                    p_style_influence: input.styleInfluence,
                    p_weirdness: input.weirdness,
                    p_variety: input.variety,
                    p_exclude_styles: input.excludeStyles,
                } : {}),
            }, cfg)
            : await rpc(allowanceCapable ? 'music_create_quote_with_daily_allowance' : 'music_create_quote', {
                p_auth_id: authId,
                p_prompt: input.prompt,
                p_title: input.title,
                p_model_id: input.modelId,
                p_variety: input.variety,
                p_style_influence: input.styleInfluence,
                p_exclude_styles: input.excludeStyles,
                p_duration_seconds: input.durationSeconds,
                ...(providerContract === MUSIC_CRUN_CONTRACT ? {
                    p_provider_contract: providerContract,
                    p_instrumental: input.instrumental,
                    p_suno_model: input.sunoModel,
                    p_vocal_gender: input.vocalGender,
                    p_weirdness: input.weirdness,
                } : {}),
                // Sent only when used, so a quote without them still reaches the
                // 8-argument function if 0514 is not applied yet.
                ...(input.bpm !== null || input.keyScale !== null || input.timeSignature !== null ? {
                    p_bpm: input.bpm,
                    p_key_scale: input.keyScale,
                    p_time_signature: input.timeSignature,
                } : {}),
            }, cfg);
    } catch (error) {
        console.error('[music/quotes] rpc failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
    if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
    return reply({
        quote_id: result.quote_id,
        mode: result.mode || input.mode,
        model_id: result.model_id,
        provider_contract: result.provider_contract,
        output_count: 1,
        credits_per_candidate: result.unit_credits,
        total_credits: result.charged_credits ?? result.total_credits,
        ...(allowanceCapable ? {
            list_credits: result.list_credits ?? result.total_credits,
            daily_free_candidates: result.daily_free_candidates ?? 0,
            ...(result.daily_allowance_reset_at ? { daily_allowance_reset_at: result.daily_allowance_reset_at } : {}),
        } : {}),
        balance: result.balance,
        balance_after: result.balance_after,
        affordable: result.affordable === true,
        expires_at: result.expires_at,
        policy_version: policy.version,
        ...(result.suno_model ? { suno_model: result.suno_model } : {}),
        ...(result.vocal_gender ? { vocal_gender: result.vocal_gender } : {}),
        ...(result.style_weight !== undefined ? { style_weight: result.style_weight } : {}),
        ...(result.weirdness !== undefined ? { weirdness: result.weirdness } : {}),
        ...(result.variety !== undefined ? { variety: result.variety } : {}),
        ...(result.exclude_styles_applied_chars !== undefined
            ? { exclude_styles_applied_chars: result.exclude_styles_applied_chars } : {}),
    }, 201);
}
