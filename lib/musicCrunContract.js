export const MUSIC_FAL_CONTRACT = 'fal-ace-v1';
export const MUSIC_CRUN_CONTRACT = 'crun-suno-v1';
export const MUSIC_CANONICAL_WAV_MAX_BYTES = 26_214_400;
export const MUSIC_TRACK_ADD_MP3_MAX_BYTES = 10_485_760;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODELS = Object.freeze({
    'ace-step': Object.freeze({ modes: ['simple'], paid: false, instrumentalOnly: true }),
    'ace-step-1.5': Object.freeze({ modes: ['simple', 'custom'], paid: true, instrumentalOnly: false }),
});

export const CRUN_SUNO_LIMITS = Object.freeze({
    prompt: 500,
    title: 80,
    lyrics: 5000,
    styles: 1000,
    exclude_styles: 1000,
    exclude_styles_applied: 200,
    duration_seconds: Object.freeze({ min: 1, max: 135, default: 60, custom_only: true }),
    variety: Object.freeze({ min: 0, max: 100, provider_min: 0, provider_max: 4 }),
    style_weight: Object.freeze({ min: 0, max: 1 }),
    weirdness: Object.freeze({ min: 0, max: 1 }),
});

export const CRUN_SUNO_VARIETY_LABELS = Object.freeze(['Off', 'Normal', 'High', 'Extra', 'Max']);
export const CRUN_SUNO_MODELS = Object.freeze(['v6', 'v6_mini', 'v6_wild']);
export const CRUN_SUNO_VOCAL_GENDERS = Object.freeze(['auto', 'male', 'female']);

// 7,080 user-visible code points can each occupy four UTF-8 bytes. The fixed
// object shape, punctuation, booleans and numeric controls fit comfortably in
// the remaining 4,448 bytes. This limit is route-local; ordinary music JSON
// requests retain the existing 8 KiB ceiling.
// JSON escapes can expand otherwise valid control characters and lone
// surrogates to six bytes. 48 KiB covers the 42,480-byte escaped-text worst
// case plus the fixed request shape without widening unrelated routes.
export const MUSIC_CRUN_JSON_MAX_BYTES = 96 * 1024;
export const MUSIC_CRUN_MAX_TEXT_UTF8_BYTES = (
    CRUN_SUNO_LIMITS.lyrics + CRUN_SUNO_LIMITS.styles
    + CRUN_SUNO_LIMITS.exclude_styles + CRUN_SUNO_LIMITS.title
) * 4;

function exactKeys(value, allowed) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).every((key) => allowed.has(key));
}

// Postgres text cannot hold NUL, and other C0 controls corrupt the supplier prompt. Tab, newline and carriage return stay.
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const hasControlChars = (value) => typeof value === 'string' && CONTROL_CHARS_RE.test(value);

export function musicCodePointLength(value) {
    return typeof value === 'string' ? Array.from(value).length : Infinity;
}

export function musicProviderContract(providerEndpoint) {
    if (providerEndpoint === 'crun:suno/music-generate') return MUSIC_CRUN_CONTRACT;
    if (providerEndpoint === 'fal-ai/ace-step' || providerEndpoint === 'fal-ai/ace-step-1.5') {
        return MUSIC_FAL_CONTRACT;
    }
    return null;
}

export function crunOfferContract(modelId) {
    const offer = MODELS[modelId];
    return offer ? { ...offer, provider_contract: MUSIC_CRUN_CONTRACT, limits: CRUN_SUNO_LIMITS } : null;
}

export function crunVarietyBucket(value) {
    return Math.round(value / 25);
}

export function crunStyleWeight(value) {
    return value / 100;
}

const SIMPLE_KEYS = new Set([
    'mode', 'provider_contract', 'prompt', 'title', 'instrumental', 'model_id', 'suno_model',
    'variety', 'style_influence', 'exclude_styles', 'duration_seconds',
    'vocal_gender', 'weirdness', 'bpm', 'key_scale', 'time_signature', 'daily_allowance_capable',
]);
const CUSTOM_KEYS = new Set([
    'mode', 'provider_contract', 'draft_id', 'draft_revision', 'instrumental',
    'rights_confirmed', 'duration_seconds', 'suno_model', 'vocal_gender',
    'style_influence', 'weirdness', 'variety', 'exclude_styles',
    'bpm', 'key_scale', 'time_signature', 'daily_allowance_capable',
]);
const DRAFT_KEYS = new Set([
    'provider_contract', 'draft_id', 'revision', 'model_id', 'lyrics', 'styles', 'title',
]);

function parseControls(value, { custom }) {
    if (value.bpm !== undefined || value.key_scale !== undefined || value.time_signature !== undefined) {
        return { ok: false, error: 'advanced_controls_invalid' };
    }
    const sunoModel = value.suno_model ?? 'v6';
    const vocalGender = value.vocal_gender ?? 'auto';
    const variety = value.variety ?? null;
    const styleInfluence = value.style_influence ?? null;
    const weirdness = value.weirdness ?? null;
    const excludeStyles = typeof value.exclude_styles === 'string'
        ? value.exclude_styles.trim() || null : value.exclude_styles ?? null;
    const durationSeconds = value.duration_seconds ?? CRUN_SUNO_LIMITS.duration_seconds.default;
    if (!CRUN_SUNO_MODELS.includes(sunoModel)) return { ok: false, error: 'suno_model_invalid' };
    if (!CRUN_SUNO_VOCAL_GENDERS.includes(vocalGender)) return { ok: false, error: 'vocal_gender_invalid' };
    if (variety !== null && (!Number.isInteger(variety) || variety < 0 || variety > 100)) {
        return { ok: false, error: 'variety_invalid' };
    }
    if (styleInfluence !== null && (!Number.isInteger(styleInfluence)
        || styleInfluence < 0 || styleInfluence > 100)) {
        return { ok: false, error: 'style_influence_invalid' };
    }
    if (weirdness !== null && (typeof weirdness !== 'number'
        || !Number.isFinite(weirdness) || weirdness < 0 || weirdness > 1)) {
        return { ok: false, error: 'weirdness_invalid' };
    }
    if (excludeStyles !== null && (typeof excludeStyles !== 'string'
        || musicCodePointLength(excludeStyles) > CRUN_SUNO_LIMITS.exclude_styles || hasControlChars(excludeStyles))) {
        return { ok: false, error: 'exclude_styles_invalid' };
    }
    if (!custom && value.duration_seconds !== undefined) return { ok: false, error: 'duration_invalid' };
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 135) {
        return { ok: false, error: 'duration_invalid' };
    }
    return {
        ok: true, sunoModel, vocalGender, variety, styleInfluence, weirdness,
        excludeStyles, durationSeconds,
        varietyBucket: variety === null ? null : crunVarietyBucket(variety),
        styleWeight: styleInfluence === null ? null : crunStyleWeight(styleInfluence),
        bpm: null, keyScale: null, timeSignature: null,
    };
}

export function parseCrunMusicQuote(value) {
    const mode = value && typeof value === 'object' && !Array.isArray(value) ? value.mode ?? 'simple' : 'simple';
    if (mode === 'custom') {
        if (!exactKeys(value, CUSTOM_KEYS)) return { ok: false, error: 'invalid_request' };
        if (value.daily_allowance_capable !== undefined && typeof value.daily_allowance_capable !== 'boolean') {
            return { ok: false, error: 'invalid_request' };
        }
        if (value.provider_contract !== MUSIC_CRUN_CONTRACT) return { ok: false, error: 'contract_invalid' };
        if (!UUID_RE.test(value.draft_id || '')) return { ok: false, error: 'draft_id_invalid' };
        if (!Number.isSafeInteger(value.draft_revision) || value.draft_revision < 0) {
            return { ok: false, error: 'revision_invalid' };
        }
        if (typeof value.instrumental !== 'boolean' || typeof value.rights_confirmed !== 'boolean') {
            return { ok: false, error: 'custom_mode_invalid' };
        }
        if (!value.instrumental && value.rights_confirmed !== true) return { ok: false, error: 'lyrics_rights_required' };
        if (value.instrumental && value.rights_confirmed !== false) return { ok: false, error: 'lyrics_rights_not_applicable' };
        const controls = parseControls(value, { custom: true });
        if (!controls.ok) return controls;
        return {
            ok: true, mode, draftRevision: value.draft_revision, draftId: value.draft_id,
            providerContract: value.provider_contract, instrumental: value.instrumental,
            rightsConfirmed: value.rights_confirmed, ...controls,
            ...(value.daily_allowance_capable === true ? { dailyAllowanceCapable: true } : {}),
        };
    }
    if (!exactKeys(value, SIMPLE_KEYS)) return { ok: false, error: 'invalid_request' };
    if (value.daily_allowance_capable !== undefined && typeof value.daily_allowance_capable !== 'boolean') {
        return { ok: false, error: 'invalid_request' };
    }
    if (value.provider_contract !== undefined && value.provider_contract !== MUSIC_CRUN_CONTRACT) {
        return { ok: false, error: 'contract_invalid' };
    }
    if (mode !== 'simple') return { ok: false, error: 'mode_not_supported' };
    const modelId = value.model_id ?? 'ace-step';
    const offer = MODELS[modelId];
    if (!offer) return { ok: false, error: 'model_not_supported' };
    const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    const instrumental = value.instrumental ?? true;
    if (!prompt || musicCodePointLength(prompt) > CRUN_SUNO_LIMITS.prompt || hasControlChars(prompt)) return { ok: false, error: 'prompt_invalid' };
    if (musicCodePointLength(title) > CRUN_SUNO_LIMITS.title || hasControlChars(title)) return { ok: false, error: 'title_invalid' };
    if (typeof instrumental !== 'boolean') return { ok: false, error: 'instrumental_invalid' };
    if (offer.instrumentalOnly && !instrumental) return { ok: false, error: 'instrumental_required' };
    const custom = Boolean(title || value.variety !== undefined || value.style_influence !== undefined
        || value.exclude_styles !== undefined || value.weirdness !== undefined
        || (value.duration_seconds !== undefined && value.duration_seconds !== 60)
        || (value.vocal_gender !== undefined && value.vocal_gender !== 'auto'));
    if (custom && modelId !== 'ace-step-1.5') return { ok: false, error: 'advanced_controls_invalid' };
    if (instrumental && value.vocal_gender !== undefined && value.vocal_gender !== 'auto') {
        return { ok: false, error: 'vocal_gender_invalid' };
    }
    const controls = parseControls(value, { custom });
    if (!controls.ok) return controls;
    if (custom && !instrumental) return { ok: false, error: 'lyrics_required' };
    return {
        ok: true, prompt, title: title || null, mode, providerMode: custom ? 'custom' : 'simple',
        modelId, instrumental, providerContract: MUSIC_CRUN_CONTRACT,
        ...(value.daily_allowance_capable === true ? { dailyAllowanceCapable: true } : {}), ...controls,
    };
}

export function parseCrunMusicDraft(value) {
    if (!exactKeys(value, DRAFT_KEYS)) return { ok: false, error: 'invalid_request' };
    if (value.provider_contract !== MUSIC_CRUN_CONTRACT) return { ok: false, error: 'contract_invalid' };
    if (value.draft_id !== null && !UUID_RE.test(value.draft_id || '')) return { ok: false, error: 'draft_id_invalid' };
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) return { ok: false, error: 'revision_invalid' };
    if (value.model_id !== 'ace-step-1.5') return { ok: false, error: 'model_invalid' };
    if (typeof value.lyrics !== 'string' || musicCodePointLength(value.lyrics) > CRUN_SUNO_LIMITS.lyrics || hasControlChars(value.lyrics)) {
        return { ok: false, error: 'lyrics_invalid' };
    }
    if (typeof value.styles !== 'string' || musicCodePointLength(value.styles) > CRUN_SUNO_LIMITS.styles || hasControlChars(value.styles)) {
        return { ok: false, error: 'styles_invalid' };
    }
    if (typeof value.title !== 'string' || musicCodePointLength(value.title) > CRUN_SUNO_LIMITS.title || hasControlChars(value.title)) {
        return { ok: false, error: 'title_invalid' };
    }
    return {
        ok: true, providerContract: value.provider_contract, draftId: value.draft_id,
        revision: value.revision, modelId: value.model_id,
        lyrics: value.lyrics, styles: value.styles, title: value.title,
    };
}

export function crunEntitlement(model, availability = null) {
    const offer = MODELS[model?.id];
    if (!offer) return null;
    const premium = model.id === 'ace-step-1.5';
    const allowedModels = (premium ? CRUN_SUNO_MODELS : ['v6']).filter((name) => availability?.suno_models?.[name] !== false);
    return {
        provider_contract: MUSIC_CRUN_CONTRACT,
        generation_modes: offer.modes,
        instrumental_only: offer.instrumentalOnly,
        requires_paid_plan: offer.paid,
        controls: {
            description: true,
            instrumental: premium ? 'optional' : 'required',
            lyrics: premium,
            lyrics_required_for_custom_vocal: premium,
            styles: premium,
            title: premium,
            exclude_styles: premium,
            vocal_gender: premium ? CRUN_SUNO_VOCAL_GENDERS : [],
            suno_model: allowedModels,
            style_influence: premium,
            weirdness: premium,
            variety: premium ? CRUN_SUNO_VARIETY_LABELS : [],
            duration_seconds: premium ? CRUN_SUNO_LIMITS.duration_seconds : null,
            tempo_key_meter: false,
        },
        limits: CRUN_SUNO_LIMITS,
        counters: {
            lyrics: { max: CRUN_SUNO_LIMITS.lyrics },
            styles: { max: CRUN_SUNO_LIMITS.styles },
            exclude_styles: { max: CRUN_SUNO_LIMITS.exclude_styles, applied: CRUN_SUNO_LIMITS.exclude_styles_applied },
            title: { max: CRUN_SUNO_LIMITS.title },
            prompt: { max: CRUN_SUNO_LIMITS.prompt },
        },
    };
}

export function musicVersionCapabilities({ mimeType, sizeBytes }) {
    const mime = String(mimeType || '').toLowerCase();
    const bytes = Number(sizeBytes);
    const knownSize = Number.isSafeInteger(bytes) && bytes > 0;
    const canonicalWav = mime === 'audio/wav' && knownSize && bytes <= MUSIC_CANONICAL_WAV_MAX_BYTES;
    const mp3 = (mime === 'audio/mpeg' || mime === 'audio/mp3') && knownSize;
    return Object.freeze({
        playback: mime.startsWith('audio/') && knownSize,
        download: mime.startsWith('audio/') && knownSize,
        render: canonicalWav,
        crop: canonicalWav,
        remix: canonicalWav,
        mashup: canonicalWav,
        sample: canonicalWav,
        stems: mp3 && bytes <= MUSIC_TRACK_ADD_MP3_MAX_BYTES,
        target_stem: (mime === 'audio/mpeg' || mime === 'audio/wav') && knownSize,
        track_add: mime === 'audio/mpeg' && knownSize && bytes <= MUSIC_TRACK_ADD_MP3_MAX_BYTES,
        cover: (mime === 'audio/mpeg' || mime === 'audio/wav') && knownSize,
        extend: (mime === 'audio/mpeg' || mime === 'audio/wav') && knownSize,
        replace_section: (mime === 'audio/mpeg' || mime === 'audio/wav') && knownSize,
        add_section: (mime === 'audio/mpeg' || mime === 'audio/wav') && knownSize,
    });
}

export function editUnavailableForFormat({ mimeType, sizeBytes }) {
    return !musicVersionCapabilities({ mimeType, sizeBytes }).render;
}
