import { readBoundedBody } from './boundedBody.js';
import { musicDispatchSchemaEnabled, musicRuntimeFlag } from './musicRuntime.js';
import { parseMusicTempoControls } from './musicTempoControls.js';

export const MUSIC_MODEL_ID = 'ace-step';
export const MUSIC_PREMIUM_MODEL_ID = 'ace-step-1.5';
export const MUSIC_MODEL_IDS = Object.freeze([MUSIC_MODEL_ID, MUSIC_PREMIUM_MODEL_ID]);
export const MUSIC_PROMPT_MAX = 500;
export const MUSIC_TITLE_MAX = 80;
export const MUSIC_LYRICS_MAX = 3000;
export const MUSIC_STYLES_MAX = 500;
export const MUSIC_EXCLUDE_STYLES_MAX = 500;
export const MUSIC_DURATION_MIN = 10;
export const MUSIC_DURATION_MAX = 60;
export const MUSIC_WORKSPACE_NAME_MAX = 80;
export const MUSIC_MOVE_MAX = 50;
export const MUSIC_SHARED_CONCURRENCY_LIMIT = 4;
export const MUSIC_POLICY_VERSION = 'music-prompt-v1';
export const MUSIC_COVER_MODEL_ID = 'stable-audio-3-cover';
export const MUSIC_COVER_PROMPT_MAX = 500;
export const MUSIC_COVER_DURATION_MAX = 120;
export const MUSIC_STEM_MODEL_ID = 'mureka-stems-v3';
export const MUSIC_TARGET_STEM_MODEL_ID = 'sam-audio-target-stem';
export const MUSIC_TARGET_STEM_DURATION_MAX = 120;
export const MUSIC_TARGET_STEM_INSTRUMENTS = Object.freeze([
    'vocals', 'drums', 'bass', 'guitar', 'piano', 'strings', 'synthesizer', 'brass', 'woodwinds',
]);
export const MUSIC_TRACK_UPLOAD_MODEL_ID = 'mureka-audio-upload';
export const MUSIC_TRACK_ADD_MODEL_ID = 'mureka-track-add-v8';
export const MUSIC_TRACK_ADD_SOURCE_MAX = 120;
export const MUSIC_EXTEND_MODEL_ID = 'ace-step-extend';
export const MUSIC_EXTEND_SECONDS = 30;
export const MUSIC_EXTEND_DURATION_MAX = 120;
export const MUSIC_REPLACE_MODEL_ID = 'ace-step-replace-section';
export const MUSIC_REPLACE_DURATION_MAX = 60;
export const MUSIC_REPLACE_RANGE_MAX = 30;
export const MUSIC_ADD_SECTION_MODEL_ID = 'ace-step-add-section';
export const MUSIC_ADD_SECTION_DURATION_MAX = 30;
export const MUSIC_ADD_SECTION_SOURCE_MAX = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// The pair RPC derives two platform job keys by appending `.1` and `.2`.
// Keep the caller key below the ledger's 128-character ceiling.
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,120}$/;
const QUOTE_KEYS = new Set([
    'mode', 'prompt', 'title', 'instrumental', 'model_id',
    'variety', 'style_influence', 'exclude_styles', 'duration_seconds',
    'bpm', 'key_scale', 'time_signature',
]);
const CUSTOM_QUOTE_KEYS = new Set([
    'mode', 'draft_revision', 'instrumental', 'rights_confirmed', 'duration_seconds',
]);
const GENERATION_KEYS = new Set(['quote_id', 'idempotency_key']);
const COVER_QUOTE_KEYS = new Set(['version_id', 'prompt', 'source_influence', 'rights_confirmed']);
const STEM_QUOTE_KEYS = new Set(['version_id', 'rights_confirmed']);
const TARGET_STEM_QUOTE_KEYS = new Set(['version_id', 'instrument', 'rights_confirmed']);
const TRACK_ADD_QUOTE_KEYS = new Set([
    'version_id', 'mode', 'prompt', 'lyrics', 'vocal_gender', 'rights_confirmed', 'lyrics_rights_confirmed',
]);
const EXTEND_QUOTE_KEYS = new Set(['version_id', 'prompt', 'rights_confirmed']);
const REPLACE_QUOTE_KEYS = new Set(['version_id', 'prompt', 'start_seconds', 'end_seconds', 'rights_confirmed']);
const ADD_SECTION_QUOTE_KEYS = new Set(['version_id', 'position', 'duration_seconds', 'lyrics', 'styles', 'rights_confirmed']);
const REPLACE_COMMIT_KEYS = new Set(['generation_id', 'version_id', 'idempotency_key']);
const REUSE_DRAFT_KEYS = new Set(['version_id', 'draft_revision', 'reuse_lyrics', 'reuse_styles', 'idempotency_key']);
const CUSTOM_DRAFT_KEYS = new Set(['revision', 'model_id', 'lyrics', 'styles', 'title']);
const WORKSPACE_CREATE_KEYS = new Set(['name', 'idempotency_key']);
const SONG_MOVE_KEYS = new Set(['destination_workspace_id', 'songs', 'idempotency_key']);
const SONG_MOVE_ITEM_KEYS = new Set(['id', 'revision']);
const SONG_LIFECYCLE_KEYS = new Set(['action', 'revision']);
const SHARE_LINK_CREATE_KEYS = new Set(['version_id', 'token', 'idempotency_key']);
const SHARE_LINK_REVOKE_KEYS = new Set(['idempotency_key']);
const EXPORT_QUOTE_KEYS = new Set(['version_id', 'format']);
const EXPORT_START_KEYS = new Set(['quote_id', 'idempotency_key']);
const MODEL_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const musicSchemaEnabled = (env = process.env) => musicRuntimeFlag('schema', env);
export const musicUiEnabled = (env = process.env) => musicRuntimeFlag('ui', env);
export const musicLibraryEnabled = (env = process.env) => musicSchemaEnabled(env)
    && musicRuntimeFlag('library', env);

export const musicReferencesEnabled = (env = process.env) => musicLibraryEnabled(env)
    && musicRuntimeFlag('references', env);

export const musicDistributionEnabled = (env = process.env) => musicLibraryEnabled(env)
    && musicRuntimeFlag('distribution', env);

export const musicSourcesEnabled = (env = process.env) => musicLibraryEnabled(env)
    && musicRuntimeFlag('sources', env);

export const musicPublicationEnabled = (env = process.env) => musicDistributionEnabled(env)
    && musicRuntimeFlag('publication', env);

export const musicEditingEnabled = (env = process.env) => musicLibraryEnabled(env)
    && musicRuntimeFlag('editing', env);

export const musicPlaylistsEnabled = (env = process.env) => musicLibraryEnabled(env)
    && musicRuntimeFlag('playlists', env);

export const musicGenerationEnabled = (env = process.env) => musicSchemaEnabled(env)
    && musicRuntimeFlag('generation', env)
    && musicDispatchSchemaEnabled(env);

export const musicCoverEnabled = (env = process.env) => musicGenerationEnabled(env)
    && musicLibraryEnabled(env)
    && musicRuntimeFlag('cover', env);

export const musicStemsEnabled = (env = process.env) => musicGenerationEnabled(env)
    && musicLibraryEnabled(env)
    && musicRuntimeFlag('stems', env);

export const musicTargetStemsEnabled = (env = process.env) => musicGenerationEnabled(env)
    && musicLibraryEnabled(env)
    && musicRuntimeFlag('targetStems', env);

export const musicTrackAddEnabled = (env = process.env) => musicGenerationEnabled(env)
    && musicLibraryEnabled(env)
    && musicRuntimeFlag('trackAdd', env);

export const musicStudioEnabled = (env = process.env) => musicLibraryEnabled(env)
    && musicRuntimeFlag('studio', env);

export const musicExtendEnabled = (env = process.env) => musicGenerationEnabled(env)
    && musicLibraryEnabled(env)
    && musicRuntimeFlag('extend', env);

export const musicReuseEnabled = (env = process.env) => musicLibraryEnabled(env)
    && musicRuntimeFlag('reuse', env);

export const musicReplaceEnabled = (env = process.env) => musicGenerationEnabled(env)
    && musicLibraryEnabled(env)
    && musicRuntimeFlag('replace', env);

export const musicAddSectionEnabled = (env = process.env) => musicGenerationEnabled(env)
    && musicLibraryEnabled(env)
    && musicRuntimeFlag('addSection', env);

/**
 * Clean-room, deliberately narrow pre-debit policy. It catches only high-
 * confidence combinations at this boundary and always returns one public
 * refusal. Provider enforcement remains authoritative after submission.
 */
export function musicPromptPolicy(prompt) {
    const value = String(prompt || '').normalize('NFKC').toLowerCase();
    const sexual = /\b(?:erotic|porn(?:ographic)?|sexual(?:ly)?|sex)\b/.test(value);
    const minor = /\b(?:child|children|minor|underage|preteen|pre-teen)\b/.test(value);
    const nonConsensual = /\b(?:non[- ]?consensual|rape|sexual assault)\b/.test(value);
    if (sexual && (minor || nonConsensual)) {
        return { ok: false, error: 'prompt_not_allowed', version: MUSIC_POLICY_VERSION };
    }
    return { ok: true, version: MUSIC_POLICY_VERSION };
}

/** Public, provider-free projection used by the authenticated create screen. */
export function musicEntitlementProjection({ models, credits, generationEnabled, subscription, now = Date.now() }) {
    const paidPeriodEnd = Date.parse(subscription?.current_period_end || '');
    const paidPlan = subscription?.status === 'active'
        && Number.isFinite(paidPeriodEnd)
        && paidPeriodEnd > now;
    const verified = (Array.isArray(models) ? models : [])
        .filter((model) => MUSIC_MODEL_IDS.includes(model?.id)
            && model?.modality === 'text-to-audio'
            && model?.gated === false
            && Number.isFinite(Number(model?.credits))
            && Number(model.credits) > 0)
        .sort((left, right) => MUSIC_MODEL_IDS.indexOf(left.id) - MUSIC_MODEL_IDS.indexOf(right.id))
        .map((model) => ({
            ...(() => {
                const inputs = model?.capabilities?.inputs || {};
                return {
                    generation_modes: model.id === MUSIC_PREMIUM_MODEL_ID ? ['simple', 'custom'] : ['simple'],
                    controls: {
                        description: Boolean(inputs.prompt) || model.id === MUSIC_MODEL_ID,
                        seed: Boolean(inputs.seed),
                        variety: model.id === MUSIC_PREMIUM_MODEL_ID,
                        style_influence: model.id === MUSIC_PREMIUM_MODEL_ID,
                        exclude_styles: model.id === MUSIC_PREMIUM_MODEL_ID,
                        tempo_key_meter: model.id === MUSIC_PREMIUM_MODEL_ID,
                        duration_seconds: {
                            min: MUSIC_DURATION_MIN,
                            max: MUSIC_DURATION_MAX,
                            default: MUSIC_DURATION_MAX,
                        },
                        lyrics: model.id === MUSIC_PREMIUM_MODEL_ID || Boolean(inputs.lyrics),
                        styles: model.id === MUSIC_PREMIUM_MODEL_ID || Boolean(inputs.styles),
                        instrumental: model.id === MUSIC_PREMIUM_MODEL_ID ? 'optional' : 'required',
                    },
                };
            })(),
            id: model.id,
            name: String(model.name || 'ACE-Step'),
            credits_per_candidate: Number(model.credits),
            total_credits: Number(model.credits) * 2,
            instrumental_only: model.id !== MUSIC_PREMIUM_MODEL_ID,
            requires_paid_plan: model.id === MUSIC_PREMIUM_MODEL_ID,
            available: model.id !== MUSIC_PREMIUM_MODEL_ID || paidPlan,
        }));
    return {
        available: generationEnabled === true && verified.some((model) => model.available),
        mode: 'simple',
        output_count: 2,
        concurrency_limit: MUSIC_SHARED_CONCURRENCY_LIMIT,
        balance: Number(credits?.balance) || 0,
        free_credits: Number(credits?.free_credits) || 0,
        free_expires_at: credits?.free_expires_at || null,
        models: verified,
        custom_drafts: {
            available: true,
            autosave: true,
            generation_supported: verified.some((model) => model.available && model.generation_modes.includes('custom')),
            lyrics_max: MUSIC_LYRICS_MAX,
            styles_max: MUSIC_STYLES_MAX,
            title_max: MUSIC_TITLE_MAX,
        },
        policy: { version: MUSIC_POLICY_VERSION, pre_debit: true },
    };
}

export function validMusicAuthId(value) {
    return UUID_RE.test(value || '');
}

export async function readMusicJson(request) {
    try {
        const bytes = await readBoundedBody(request.body, 8192, request.signal);
        return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
    } catch (error) {
        return { ok: false, error: error?.status === 413 ? 'body_too_large' : 'invalid_json' };
    }
}

function exactKeys(value, allowed) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).every((key) => allowed.has(key));
}

export function parseMusicCustomDraft(value) {
    if (!exactKeys(value, CUSTOM_DRAFT_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
        return { ok: false, error: 'revision_invalid' };
    }
    if (typeof value.model_id !== 'string' || !MODEL_ID_RE.test(value.model_id)) {
        return { ok: false, error: 'model_invalid' };
    }
    if (typeof value.lyrics !== 'string' || value.lyrics.length > MUSIC_LYRICS_MAX) {
        return { ok: false, error: 'lyrics_invalid' };
    }
    if (typeof value.styles !== 'string' || value.styles.length > MUSIC_STYLES_MAX) {
        return { ok: false, error: 'styles_invalid' };
    }
    if (typeof value.title !== 'string' || value.title.length > MUSIC_TITLE_MAX) {
        return { ok: false, error: 'title_invalid' };
    }
    return {
        ok: true,
        revision: value.revision,
        modelId: value.model_id,
        lyrics: value.lyrics,
        styles: value.styles,
        title: value.title,
    };
}

export function parseMusicWorkspaceCreate(value) {
    if (!exactKeys(value, WORKSPACE_CREATE_KEYS)) return { ok: false, error: 'invalid_request' };
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!name || name.length > MUSIC_WORKSPACE_NAME_MAX) return { ok: false, error: 'name_invalid' };
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    return { ok: true, name, idempotencyKey: value.idempotency_key };
}

export function parseMusicSongMove(value) {
    if (!exactKeys(value, SONG_MOVE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.destination_workspace_id || '')) {
        return { ok: false, error: 'workspace_id_invalid' };
    }
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    if (!Array.isArray(value.songs) || value.songs.length < 1 || value.songs.length > MUSIC_MOVE_MAX) {
        return { ok: false, error: 'songs_invalid' };
    }
    const seen = new Set();
    const songs = [];
    for (const item of value.songs) {
        if (!exactKeys(item, SONG_MOVE_ITEM_KEYS) || !UUID_RE.test(item.id || '')
            || !Number.isSafeInteger(item.revision) || item.revision < 0
            || item.revision > 2_147_483_647 || seen.has(item.id)) {
            return { ok: false, error: 'songs_invalid' };
        }
        seen.add(item.id);
        songs.push({ id: item.id, revision: item.revision });
    }
    return {
        ok: true,
        destinationWorkspaceId: value.destination_workspace_id,
        idempotencyKey: value.idempotency_key,
        songs,
    };
}

export function parseMusicSongLifecycle(value) {
    if (!exactKeys(value, SONG_LIFECYCLE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!['trash', 'restore'].includes(value.action)) return { ok: false, error: 'action_invalid' };
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision > 2_147_483_647) {
        return { ok: false, error: 'revision_invalid' };
    }
    return { ok: true, action: value.action, revision: value.revision };
}

export function parseMusicShareLinkCreate(value) {
    if (!exactKeys(value, SHARE_LINK_CREATE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    if (!SHARE_TOKEN_RE.test(value.token || '')) return { ok: false, error: 'share_token_invalid' };
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    return {
        ok: true,
        versionId: value.version_id,
        token: value.token,
        idempotencyKey: value.idempotency_key,
    };
}

export function parseMusicShareLinkRevoke(value) {
    if (!exactKeys(value, SHARE_LINK_REVOKE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    return { ok: true, idempotencyKey: value.idempotency_key };
}

export function parseMusicExportQuote(value) {
    if (!exactKeys(value, EXPORT_QUOTE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    if (!['mp3', 'wav', 'flac'].includes(value.format)) return { ok: false, error: 'format_not_supported' };
    return { ok: true, versionId: value.version_id, format: value.format };
}

export function parseMusicExportStart(value) {
    if (!exactKeys(value, EXPORT_START_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.quote_id || '')) return { ok: false, error: 'quote_id_invalid' };
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    return { ok: true, quoteId: value.quote_id, idempotencyKey: value.idempotency_key };
}

export function parseMusicQuote(value) {
    const mode = value && typeof value === 'object' && !Array.isArray(value) ? value.mode ?? 'simple' : 'simple';
    if (mode === 'custom') {
        if (!exactKeys(value, CUSTOM_QUOTE_KEYS)) return { ok: false, error: 'invalid_request' };
        const durationSeconds = value.duration_seconds ?? MUSIC_DURATION_MAX;
        if (!Number.isInteger(value.draft_revision) || value.draft_revision < 0
            || value.draft_revision > 2_147_483_647) return { ok: false, error: 'revision_invalid' };
        if (typeof value.instrumental !== 'boolean' || typeof value.rights_confirmed !== 'boolean') {
            return { ok: false, error: 'custom_mode_invalid' };
        }
        if (!value.instrumental && value.rights_confirmed !== true) {
            return { ok: false, error: 'lyrics_rights_required' };
        }
        if (value.instrumental && value.rights_confirmed !== false) {
            return { ok: false, error: 'lyrics_rights_not_applicable' };
        }
        if (!Number.isInteger(durationSeconds)
            || durationSeconds < MUSIC_DURATION_MIN || durationSeconds > MUSIC_DURATION_MAX) {
            return { ok: false, error: 'duration_invalid' };
        }
        return {
            ok: true, mode, draftRevision: value.draft_revision,
            instrumental: value.instrumental,
            rightsConfirmed: value.rights_confirmed, durationSeconds,
        };
    }
    if (!exactKeys(value, QUOTE_KEYS)) return { ok: false, error: 'invalid_request' };
    const modelId = value.model_id ?? MUSIC_MODEL_ID;
    const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    if (mode !== 'simple') return { ok: false, error: 'mode_not_supported' };
    if (value.instrumental !== undefined && value.instrumental !== true) {
        return { ok: false, error: 'instrumental_required' };
    }
    if (!MUSIC_MODEL_IDS.includes(modelId)) return { ok: false, error: 'model_not_supported' };
    const variety = value.variety ?? null;
    const durationSeconds = value.duration_seconds ?? MUSIC_DURATION_MAX;
    const styleInfluence = value.style_influence ?? null;
    const excludeStyles = typeof value.exclude_styles === 'string'
        ? value.exclude_styles.trim() || null
        : value.exclude_styles ?? null;
    const tempo = parseMusicTempoControls(value);
    if (!tempo.ok) return tempo;
    const premiumControlUsed = variety !== null || styleInfluence !== null || excludeStyles !== null || tempo.used;
    if (premiumControlUsed && modelId !== MUSIC_PREMIUM_MODEL_ID) {
        return { ok: false, error: 'advanced_controls_invalid' };
    }
    if (!Number.isInteger(durationSeconds)
        || durationSeconds < MUSIC_DURATION_MIN || durationSeconds > MUSIC_DURATION_MAX) {
        return { ok: false, error: 'duration_invalid' };
    }
    if (variety !== null && (!Number.isInteger(variety) || variety < 0 || variety > 100)) {
        return { ok: false, error: 'variety_invalid' };
    }
    if (styleInfluence !== null && (!Number.isInteger(styleInfluence)
        || styleInfluence < 0 || styleInfluence > 100)) {
        return { ok: false, error: 'style_influence_invalid' };
    }
    if (excludeStyles !== null && (typeof excludeStyles !== 'string'
        || !excludeStyles || excludeStyles.length > MUSIC_EXCLUDE_STYLES_MAX)) {
        return { ok: false, error: 'exclude_styles_invalid' };
    }
    if (!prompt || prompt.length > MUSIC_PROMPT_MAX) return { ok: false, error: 'prompt_invalid' };
    if (title.length > MUSIC_TITLE_MAX) return { ok: false, error: 'title_invalid' };
    return {
        ok: true, prompt, title: title || null, mode, modelId, instrumental: true,
        variety, styleInfluence, excludeStyles, durationSeconds,
        bpm: tempo.bpm, keyScale: tempo.keyScale, timeSignature: tempo.timeSignature,
    };
}

export function parseMusicGeneration(value) {
    if (!exactKeys(value, GENERATION_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.quote_id || '')) return { ok: false, error: 'quote_id_invalid' };
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    return { ok: true, quoteId: value.quote_id, idempotencyKey: value.idempotency_key };
}

export function parseMusicCoverQuote(value) {
    if (!exactKeys(value, COVER_QUOTE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
    if (!prompt || prompt.length > MUSIC_COVER_PROMPT_MAX) return { ok: false, error: 'prompt_invalid' };
    if (!Number.isInteger(value.source_influence)
        || value.source_influence < 10 || value.source_influence > 90) {
        return { ok: false, error: 'source_influence_invalid' };
    }
    if (value.rights_confirmed !== true) return { ok: false, error: 'source_rights_required' };
    return {
        ok: true,
        versionId: value.version_id,
        prompt,
        sourceInfluence: value.source_influence,
        rightsConfirmed: true,
    };
}

export function parseMusicStemQuote(value) {
    if (!exactKeys(value, STEM_QUOTE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    if (value.rights_confirmed !== true) return { ok: false, error: 'source_rights_required' };
    return { ok: true, versionId: value.version_id, rightsConfirmed: true };
}

export function parseMusicTargetStemQuote(value) {
    if (!exactKeys(value, TARGET_STEM_QUOTE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    if (!MUSIC_TARGET_STEM_INSTRUMENTS.includes(value.instrument)) {
        return { ok: false, error: 'instrument_invalid' };
    }
    if (value.rights_confirmed !== true) return { ok: false, error: 'source_rights_required' };
    return { ok: true, versionId: value.version_id, instrument: value.instrument, rightsConfirmed: true };
}

export function parseMusicTrackAddQuote(value) {
    if (!exactKeys(value, TRACK_ADD_QUOTE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    if (!['vocals', 'instrumental'].includes(value.mode)) return { ok: false, error: 'track_mode_invalid' };
    const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
    const lyrics = typeof value.lyrics === 'string' ? value.lyrics.trim() : '';
    const vocalGender = value.vocal_gender === undefined ? 'auto' : value.vocal_gender;
    if (!prompt || prompt.length > MUSIC_PROMPT_MAX) return { ok: false, error: 'prompt_invalid' };
    if (!['auto', 'female', 'male'].includes(vocalGender)) return { ok: false, error: 'vocal_gender_invalid' };
    if (value.mode === 'vocals') {
        if (!lyrics || lyrics.length > MUSIC_LYRICS_MAX) return { ok: false, error: 'lyrics_invalid' };
        if (value.lyrics_rights_confirmed !== true) return { ok: false, error: 'lyrics_rights_required' };
    } else if (lyrics || value.lyrics_rights_confirmed !== false || vocalGender !== 'auto') {
        return { ok: false, error: 'lyrics_not_applicable' };
    }
    if (value.rights_confirmed !== true) return { ok: false, error: 'source_rights_required' };
    return { ok: true, versionId: value.version_id, mode: value.mode, prompt,
        lyrics: value.mode === 'vocals' ? lyrics : null, vocalGender, rightsConfirmed: true,
        lyricsRightsConfirmed: value.mode === 'vocals' };
}

export function parseMusicExtendQuote(value) {
    if (!exactKeys(value, EXTEND_QUOTE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
    if (!prompt || prompt.length > MUSIC_COVER_PROMPT_MAX) return { ok: false, error: 'prompt_invalid' };
    if (value.rights_confirmed !== true) return { ok: false, error: 'source_rights_required' };
    return { ok: true, versionId: value.version_id, prompt, rightsConfirmed: true };
}

export function parseMusicReplaceQuote(value) {
    if (!exactKeys(value, REPLACE_QUOTE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
    if (!prompt || prompt.length > MUSIC_COVER_PROMPT_MAX) return { ok: false, error: 'prompt_invalid' };
    const start = Number(value.start_seconds);
    const end = Number(value.end_seconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start
        || end - start < 1 || end - start > MUSIC_REPLACE_RANGE_MAX) {
        return { ok: false, error: 'range_invalid' };
    }
    if (value.rights_confirmed !== true) return { ok: false, error: 'source_rights_required' };
    return { ok: true, versionId: value.version_id, prompt, startSeconds: start, endSeconds: end, rightsConfirmed: true };
}

export function parseMusicAddSectionQuote(value) {
    if (!exactKeys(value, ADD_SECTION_QUOTE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    if (!['beginning', 'end'].includes(value.position)) return { ok: false, error: 'section_position_invalid' };
    if (![10, 20, 30].includes(value.duration_seconds)) return { ok: false, error: 'section_duration_invalid' };
    const lyrics = typeof value.lyrics === 'string' ? value.lyrics.trim() : '';
    const styles = typeof value.styles === 'string' ? value.styles.trim() : '';
    if (lyrics.length > MUSIC_LYRICS_MAX) return { ok: false, error: 'lyrics_invalid' };
    if (!styles || styles.length > MUSIC_STYLES_MAX) return { ok: false, error: 'styles_invalid' };
    if (value.rights_confirmed !== true) return { ok: false, error: 'source_rights_required' };
    return {
        ok: true, versionId: value.version_id, position: value.position,
        durationSeconds: value.duration_seconds, lyrics: lyrics || null, styles, rightsConfirmed: true,
    };
}

export function parseMusicReplaceCommit(value) {
    if (!exactKeys(value, REPLACE_COMMIT_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.generation_id || '')) return { ok: false, error: 'generation_id_invalid' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    return {
        ok: true,
        generationId: value.generation_id,
        versionId: value.version_id,
        idempotencyKey: value.idempotency_key,
    };
}

export function parseMusicReuseDraft(value) {
    if (!exactKeys(value, REUSE_DRAFT_KEYS)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    if (!Number.isInteger(value.draft_revision) || value.draft_revision < 0) {
        return { ok: false, error: 'draft_revision_invalid' };
    }
    if (typeof value.reuse_lyrics !== 'boolean' || typeof value.reuse_styles !== 'boolean'
        || (!value.reuse_lyrics && !value.reuse_styles)) {
        return { ok: false, error: 'reuse_selection_invalid' };
    }
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    return {
        ok: true,
        versionId: value.version_id,
        draftRevision: value.draft_revision,
        reuseLyrics: value.reuse_lyrics,
        reuseStyles: value.reuse_styles,
        idempotencyKey: value.idempotency_key,
    };
}

export function musicRpcStatus(code) {
    switch (String(code || '')) {
        case 'NOT_FOUND':
        case 'HANDLE_NOT_FOUND': return 404;
        case 'QUOTE_EXPIRED':
        case 'QUOTE_ALREADY_USED':
        case 'QUOTE_STALE':
        case 'REVISION_CONFLICT':
        case 'TAKE_COMMIT_CONFLICT':
        case 'IDEMPOTENCY_CONFLICT':
        case 'CONCURRENCY_LIMIT':
        case 'ALREADY_MEMBER':
        case 'INVITE_PENDING':
        case 'INVITATION_CLOSED':
        case 'SOURCE_REMOVED':
        case 'NAME_TAKEN':
        case 'HANDLE_TAKEN':
        case 'LIMIT_REACHED': return 409;
        case 'INSUFFICIENT_BALANCE': return 402;
        case 'DOWNLOAD_ALLOWANCE_EXHAUSTED': return 402;
        case 'ACCOUNT_FROZEN': return 403;
        case 'RATE_LIMITED': return 429;
        case 'MODEL_UNAVAILABLE':
        case 'FORMAT_UNAVAILABLE':
        case 'PLAN_UNAVAILABLE':
        case 'PROVIDER_ADMISSION_PAUSED': return 503;
        case 'USER_NOT_FOUND': return 409;
        default: return 400;
    }
}

export function publicMusicError(code) {
    const value = String(code || 'music_request_rejected').toLowerCase();
    return /^[a-z0-9_]{1,64}$/.test(value) ? value : 'music_request_rejected';
}
