// Response shapes of /api/v1/music/*, copied from the route handlers (ADR-0352), not guessed.
// Fields the phone does not read are left out; unknown extra fields are ignored by the parsers.

export type MusicModelControls = {
    readonly description: boolean;
    readonly seed: boolean;
    readonly variety: boolean;
    readonly style_influence: boolean;
    readonly exclude_styles: boolean;
    readonly tempo_key_meter: boolean;
    readonly duration_seconds: { readonly min: number; readonly max: number; readonly default: number };
    readonly lyrics: boolean;
    readonly styles: boolean;
    readonly instrumental: 'optional' | 'required';
};

export type MusicModel = {
    readonly id: string;
    readonly name: string;
    readonly generation_modes: readonly string[];
    readonly controls: MusicModelControls;
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
    };
    readonly policy: { readonly version: string; readonly pre_debit: boolean };
};

export type MusicLibraryTab = 'history' | 'hooks' | 'covers';

// Rows are passed through as the server sent them (RPC json); the phone reads only what a screen needs.
export type MusicRow = Readonly<Record<string, unknown>>;

export type MusicLibraryTabData =
    | { readonly tab: 'history'; readonly songs: readonly MusicRow[] }
    | { readonly tab: 'hooks'; readonly hooks: readonly MusicRow[] }
    | { readonly tab: 'covers'; readonly images: readonly MusicRow[]; readonly covers: readonly MusicRow[] };

export type MusicSongsCollection = 'active' | 'trash';

export type MusicSongsQuery = {
    readonly limit?: number; // 1..50, server default 24
    readonly workspace?: string; // uuid; needs the library flag
    readonly q?: string; // up to 100 chars; needs the library flag
    readonly collection?: MusicSongsCollection; // 'trash' needs the library flag
};

// GET /api/v1/music/songs/:id adds a server-built `actions` list to the song row.
export type MusicSong = MusicRow & { readonly actions: readonly string[] };

export type MusicQuoteMode = 'simple' | 'custom';

export type MusicSimpleQuoteInput = {
    readonly prompt: string; // 1..500
    readonly title?: string; // up to 80
    readonly model_id?: string;
    readonly variety?: number; // 0..100, premium model only
    readonly style_influence?: number; // 0..100, premium model only
    readonly exclude_styles?: string; // up to 500, premium model only
    readonly duration_seconds?: number; // 10..60, default 60
    readonly bpm?: number; // 40..220, premium only
    readonly key_scale?: string;
    readonly time_signature?: string;
};

export type MusicCustomQuoteInput = {
    readonly draft_revision: number;
    readonly instrumental: boolean;
    readonly rights_confirmed: boolean; // true exactly when not instrumental
    readonly duration_seconds?: number;
};

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
};

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
