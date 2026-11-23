// Response shapes of /api/v1/music/*, copied from the route handlers (ADR-0352), not guessed.
// Fields the phone does not read are left out; unknown extra fields are ignored by the parsers.

export type MusicProviderContract = 'fal-ace-v1' | 'crun-suno-v1';
export type MusicSunoModel = 'v6' | 'v6_mini' | 'v6_wild';
export type MusicVocalGender = 'auto' | 'male' | 'female';
export type MusicRange = { readonly min: number; readonly max: number };
export type MusicCounter = { readonly max: number; readonly applied?: number };

export type MusicModelControls = {
    readonly description: boolean;
    readonly seed?: boolean;
    readonly variety: boolean | readonly string[];
    readonly style_influence: boolean;
    readonly exclude_styles: boolean;
    readonly tempo_key_meter: boolean;
    readonly duration_seconds: { readonly min: number; readonly max: number; readonly default: number; readonly custom_only?: boolean } | null;
    readonly duration_price_block_seconds?: number;
    readonly lyrics: boolean;
    readonly lyrics_required_for_custom_vocal?: boolean;
    readonly styles: boolean;
    readonly title?: boolean;
    readonly vocal_gender?: readonly MusicVocalGender[];
    readonly suno_model?: readonly MusicSunoModel[];
    readonly weirdness?: boolean;
    readonly instrumental: 'optional' | 'required';
};

export type MusicModel = {
    readonly id: string;
    readonly name: string;
    readonly provider_contract?: MusicProviderContract;
    readonly generation_modes: readonly string[];
    readonly controls: MusicModelControls;
    readonly limits?: Readonly<{
        prompt: number; title: number; lyrics: number; styles: number; exclude_styles: number;
        duration_seconds: { readonly min: number; readonly max: number; readonly default: number; readonly custom_only?: boolean };
        variety?: MusicRange & { readonly provider_min?: number; readonly provider_max?: number };
        style_weight?: MusicRange;
        weirdness?: MusicRange;
    }>;
    readonly counters?: Readonly<Record<'prompt' | 'title' | 'lyrics' | 'styles' | 'exclude_styles', MusicCounter>>;
    readonly credits_per_candidate: number;
    readonly total_credits: number;
    readonly instrumental_only: boolean;
    readonly requires_paid_plan: boolean;
    readonly available: boolean;
};

// GET /api/v1/music/entitlements (musicEntitlementProjection).
export type MusicEntitlements = {
    readonly available: boolean;
    readonly mode: string;
    readonly output_count: number;
    readonly concurrency_limit: number;
    readonly balance: number;
    readonly free_credits: number;
    readonly free_expires_at: string | null;
    readonly models: readonly MusicModel[];
    readonly custom_drafts: {
        readonly available: boolean;
        readonly autosave: boolean;
        readonly generation_supported: boolean;
        readonly lyrics_max: number;
        readonly styles_max: number;
        readonly title_max: number;
        readonly provider_contract?: MusicProviderContract;
    };
    readonly features: {
        readonly albums: boolean;
        readonly inspiration: boolean;
        readonly studioChat: boolean;
        readonly dailyChallenge: boolean;
        readonly persistentQueue: boolean;
    };
    readonly policy: { readonly version: string; readonly pre_debit: boolean };
};

export type MusicLibraryTab = 'history' | 'hooks' | 'covers';

// Rows are passed through as the server sent them (RPC json); the phone reads only what a screen needs.
export type MusicRow = Readonly<Record<string, unknown>>;

export type MusicLibraryTabData =
    | { readonly tab: 'history'; readonly songs: readonly MusicSongRow[] }
    | { readonly tab: 'hooks'; readonly hooks: readonly MusicHook[]; readonly dropped: number }
    | { readonly tab: 'covers'; readonly images: readonly MusicRow[]; readonly covers: readonly MusicRow[] };

export type MusicSongsCollection = 'active' | 'trash';

export type MusicSongsQuery = {
    readonly limit?: number; // 1..50, server default 24
    readonly workspace?: string; // uuid; needs the library flag
    readonly q?: string; // up to 100 chars; needs the library flag
    readonly collection?: MusicSongsCollection; // 'trash' needs the library flag
};

// GET /api/v1/music/songs/:id adds a server-built `actions` list to the song row.
export type MusicSongRow = {
    readonly id: string;
    readonly title: string;
    readonly job_id?: string;
    readonly version_id?: string;
    readonly lifecycle_status?: string;
    readonly workspace_name?: string;
    readonly audio_url?: string | null;
    readonly revision?: number;
};
export type MusicVersion = {
    readonly id: string;
    readonly version_number: number;
    readonly operation: string;
    readonly parent_version_id: string | null;
    readonly created_at: string;
    readonly mime_type?: string;
    readonly size_bytes?: number;
    readonly capabilities?: MusicVersionCapabilities;
};
export type MusicVersionCapabilities = Readonly<{
    playback?: boolean; download?: boolean; render: boolean; crop: boolean; remix?: boolean; mashup?: boolean; sample?: boolean;
    stems?: boolean; target_stem?: boolean; track_add?: boolean; cover?: boolean; extend?: boolean;
    replace_section?: boolean; add_section?: boolean;
}>;
export type MusicSongDetail = MusicSongRow & {
    readonly job_id: string;
    readonly version_id: string;
    readonly current_version: MusicVersion;
    readonly versions: readonly (MusicVersion & { readonly is_current: boolean })[];
    readonly actions: readonly string[];
    readonly provenance: Readonly<Record<string, unknown>>;
};
export type MusicSong = MusicSongDetail;
export type MusicHook = {
    readonly id: string;
    readonly song_id: string;
    readonly song_title: string;
    readonly title: string;
    readonly start_seconds: number;
    readonly end_seconds: number;
    readonly created_at: string;
    readonly audio_url: string;
};
export type MusicShareLink = {
    readonly id: string;
    readonly version_id: string;
    readonly revoked_at: string | null;
    readonly created_at: string;
};
export type MusicLifecycle = {
    readonly id: string;
    readonly revision: number;
    readonly lifecycle_status: string;
    readonly updated_at: string;
};

export type MusicQuoteMode = 'simple' | 'custom';

export type MusicSimpleQuoteInput = {
    readonly mode: 'simple';
    readonly prompt: string;
    readonly title?: string;
    readonly instrumental: boolean;
    readonly model_id: string;
    readonly provider_contract?: MusicProviderContract;
    readonly duration_seconds?: number;
    readonly suno_model?: MusicSunoModel;
    readonly variety?: number;
    readonly style_influence?: number;
    readonly exclude_styles?: string | null;
    readonly bpm?: number | null;
    readonly key_scale?: string | null;
    readonly time_signature?: string | null;
    readonly vocal_gender?: MusicVocalGender;
    readonly weirdness?: number;
};
export type MusicCustomQuoteInput = {
    readonly mode: 'custom';
    readonly provider_contract?: MusicProviderContract;
    readonly draft_id?: string;
    readonly draft_revision: number;
    readonly instrumental: boolean;
    readonly rights_confirmed: boolean;
    readonly duration_seconds: number;
    readonly suno_model?: MusicSunoModel;
    readonly vocal_gender?: MusicVocalGender;
    readonly style_influence?: number;
    readonly weirdness?: number;
    readonly variety?: number;
    readonly exclude_styles?: string;
};
export type MusicDraft = {
    readonly id: string | null;
    readonly updated_at: string | null;
    readonly revision: number;
    readonly provider_contract?: MusicProviderContract;
    readonly model_id: string;
    readonly lyrics: string;
    readonly styles: string;
    readonly title: string;
};
export type MusicDraftInput = Pick<MusicDraft, 'revision' | 'model_id' | 'lyrics' | 'styles' | 'title'>
    & Pick<MusicDraft, 'provider_contract'> & { readonly draft_id?: string | null };
export type MusicReuseContext = {
    readonly source: Readonly<Record<string, unknown>>;
    readonly draft_id: string | null;
    readonly draft_revision: number;
    readonly provider_contract: MusicProviderContract;
};
export type MusicReuseInput = {
    readonly version_id: string;
    readonly provider_contract: MusicProviderContract;
    readonly draft_id: string | null;
    readonly draft_revision: number;
    readonly reuse_lyrics: boolean;
    readonly reuse_styles: boolean;
    readonly idempotency_key: string;
};
export type MusicCandidateView = {
    readonly ordinal: number;
    readonly label: string;
    readonly state: string;
    readonly job_id: string | null;
    readonly song_id: string | null;
    readonly version_id: string | null;
    readonly error_code: string | null;
    readonly audio_url: string | null;
};
export type MusicGenerationView = {
    readonly id: string;
    readonly state: string;
    readonly model_id: string;
    readonly prompt: string;
    readonly title: string | null;
    readonly total_credits: number;
    readonly created_at: string;
    readonly candidates: readonly MusicCandidateView[];
};
export type MusicInputSnapshot = Readonly<{
    mode: MusicQuoteMode; title: string; lyrics: string; styles: string; prompt: string;
    instrumental: boolean; duration: number; model_id: string;
    variety: number; styleInfluence: number; excludeStyles: string;
    sunoModel: MusicSunoModel; vocalGender: MusicVocalGender; weirdness: number;
    bpm: string; keyScale: string; timeSignature: string;
}>;

// POST /api/v1/music/generation-quotes answers 201 with this.
export type MusicQuote = {
    readonly quote_id: string;
    readonly mode: MusicQuoteMode;
    readonly model_id: string;
    readonly output_count: number;
    readonly credits_per_candidate: number;
    readonly total_credits: number;
    readonly balance: number;
    readonly balance_after: number;
    readonly affordable: boolean;
    readonly expires_at: string;
    readonly policy_version: string;
    readonly provider_contract?: MusicProviderContract;
    readonly suno_model?: MusicSunoModel;
    readonly vocal_gender?: MusicVocalGender;
    readonly style_weight?: number;
    readonly weirdness?: number;
    readonly variety?: number;
    readonly exclude_styles_applied_chars?: number;
};

export type MusicTypedErrorCode = 'contract_stale' | 'quote_stale' | 'edit_unavailable_for_format';

export type MusicCandidate = {
    readonly ordinal: number;
    readonly label: string;
    readonly job_id: string;
    readonly state: string;
};

// POST /api/v1/music/generations answers 202 (new) or 200 (`idempotent: true`, a replay of the same key).
export type MusicGeneration = {
    readonly generation_id: string;
    readonly state: string;
    readonly candidates: readonly MusicCandidate[];
    readonly balance_after: number;
    readonly idempotent?: true;
};
