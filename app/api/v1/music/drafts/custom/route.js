import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { readFreshMusicCatalog } from '../../../../../../lib/publicCatalog.js';
import {
    MUSIC_CRUN_CONTRACT, MUSIC_CRUN_JSON_MAX_BYTES, musicRpcStatus,
    musicSchemaEnabled, parseMusicCustomDraft, publicMusicError,
    readMusicJson, validMusicAuthId,
} from '../../../../../../lib/musicBackend.js';

const reply = (body, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store' },
});

function context(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { response: reply({ error: 'not_authenticated' }, 401) };
    if (!musicSchemaEnabled()) return { response: reply({ error: 'music_unavailable' }, 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: reply({ error: 'gateway_not_configured' }, 503) };
    return { authId, cfg };
}

async function activeContract(cfg) {
    const catalog = await readFreshMusicCatalog({ cfg });
    return catalog.find((model) => model.id === 'ace-step-1.5')?.provider_contract ?? null;
}

export async function GET(request) {
    const current = context(request);
    if (current.response) return current.response;
    try {
        const providerContract = await activeContract(current.cfg);
        if (!providerContract) return reply({ error: 'music_unavailable' }, 503);
        const result = await rpc('music_get_custom_draft', {
            p_auth_id: current.authId, p_provider_contract: providerContract,
        }, current.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ provider_contract: result.provider_contract, draft: result.draft });
    } catch (error) {
        console.error('[music/custom-draft] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function PUT(request) {
    const current = context(request);
    if (current.response) return current.response;
    const decoded = await readMusicJson(request, MUSIC_CRUN_JSON_MAX_BYTES);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    try {
        const providerContract = await activeContract(current.cfg);
        if (!providerContract) return reply({ error: 'music_unavailable' }, 503);
        if (decoded.value?.provider_contract !== undefined
            && decoded.value.provider_contract !== providerContract) {
            return reply({ error: 'contract_stale' }, 409);
        }
        // Rolling compatibility: the currently deployed fal UI may omit the
        // identity fields. Crun always requires the read-bound identity.
        if (providerContract === MUSIC_CRUN_CONTRACT && decoded.value?.provider_contract === undefined) {
            return reply({ error: 'contract_stale' }, 409);
        }
        const input = parseMusicCustomDraft(decoded.value, { providerContract });
        if (!input.ok) return reply({ error: input.error }, 400);
        const result = await rpc('music_save_custom_draft', {
            p_auth_id: current.authId,
            ...(input.providerContract ? {
                p_provider_contract: input.providerContract,
                p_draft_id: input.draftId,
            } : {}),
            p_expected_revision: input.revision,
            p_model_id: input.modelId,
            p_lyrics: input.lyrics,
            p_styles: input.styles,
            p_title: input.title,
        }, current.cfg);
        if (!result?.ok) {
            return reply({
                error: publicMusicError(result?.code),
                ...(result?.code === 'REVISION_CONFLICT' ? { draft: result.draft } : {}),
            }, musicRpcStatus(result?.code));
        }
        return reply({ draft: result.draft });
    } catch (error) {
        console.error('[music/custom-draft] save failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
