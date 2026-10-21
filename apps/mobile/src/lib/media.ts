import { aiConsent } from './aiConsentStore';
import { appCache } from './appCache';
import { POLICIES, type CacheMeta } from './cache';
import { ensureOnline, observe } from './network';
import { ApiError, API_BASE, type ApiClient } from './api';

export interface CatalogModel {
    readonly id: string;
    readonly name: string;
    readonly modality: string;
    readonly credits: number;
    readonly gated: boolean;
    // Clip lengths in seconds a video model may be bought at.
    readonly durations: number[];
    readonly capabilities: {
        readonly inputs?: Record<string, unknown>;
        readonly media?: Record<string, { readonly required?: boolean; readonly label?: string; readonly maxSeconds?: number }>;
        // Present on stem-splitting models (six labelled files from one audio file). The server marks the model
        // gated in the catalog while its flag is off, so the gated check already hides it.
        readonly outputStems?: string[];
    } | null;
}

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';

export interface Job {
    readonly job_id: string;
    readonly state: JobState;
    readonly refunded?: boolean;
    readonly credits: number;
    readonly model_id: string;
    readonly error_code?: string;
    readonly created_at: string;
    readonly label?: string;
    readonly has_asset: boolean;
    // On a moderation hold: the file is not served. Absent on older servers.
    readonly held?: boolean;
    // When the stored file is removed (about 90 days after it was made). Absent or null: unknown.
    readonly asset_expires_at?: string | null;
}

export interface JobPage {
    readonly jobs: Job[];
    readonly next: { readonly before: string; readonly before_id: string } | null;
}

export type Kind = 'image' | 'video' | 'audio';

export function kindOf(modality: string): Kind | null {
    if (modality.includes('video')) return 'video';
    if (modality.includes('image')) return 'image';
    if (modality.includes('audio') || modality.includes('voice') || modality.includes('music') || modality.includes('speech')) return 'audio';
    return null;
}

const UNIT_SECONDS = 5;

// Display estimate only. The server prices from the catalog and rejects a mismatch
// (credit_confirmation_mismatch), so this can never cause an overcharge.
export function estimateCredits(model: CatalogModel, durationSeconds: number | null): number {
    const seconds = kindOf(model.modality) === 'video' ? durationSeconds ?? model.durations[0] ?? UNIT_SECONDS : UNIT_SECONDS;
    return model.credits * Math.ceil(seconds / UNIT_SECONDS);
}

const KNOWN_SLOTS = ['image', 'endImage', 'video', 'audio'];

// The one free-text input a model takes. Most take `prompt`; Auto Short takes `topic`. The video agent's
// `brief` is left out on purpose: it needs the plan step first and has its own screen.
const TEXT_KEYS = ['prompt', 'topic'] as const;
const DEFAULT_TEXT_MAX = 2000;

export function textInput(model: CatalogModel): { readonly key: string; readonly max: number } | null {
    const inputs = (model.capabilities?.inputs ?? {}) as Record<string, { max?: number } | undefined>;
    const key = TEXT_KEYS.find((k) => k in inputs);
    if (!key) return null;
    const max = inputs[key]?.max;
    return { key, max: typeof max === 'number' ? max : DEFAULT_TEXT_MAX };
}

// A model the app can drive: open, a kind it can show, every file slot a slot it can pick for,
// and something to send (a text input, or at least one required file). Stem splitting is included (ADR-0157): the
// server gates it in the catalog and answers audio_stems_unavailable (503) before any charge while its flag is off.
export function isSupported(model: CatalogModel): boolean {
    if (model.gated || kindOf(model.modality) === null) return false;
    const caps = model.capabilities;
    if (!caps) return false;
    const media = caps.media ?? {};
    if (!Object.keys(media).every((slot) => KNOWN_SLOTS.includes(slot))) return false;
    return textInput(model) !== null || Object.values(media).some((slot) => slot.required);
}

// Text-to-X models need words; edit and file-driven models take them as an optional extra.
export function promptRequired(model: CatalogModel): boolean {
    if (!textInput(model)) return false;
    return !Object.values(model.capabilities?.media ?? {}).some((slot) => slot.required);
}

// The catalog is the same public data for everyone, so a saved copy is safe to show when offline. Screens that
// build a request still send it to the server, which prices it; the saved copy is never a gate.
export function fetchCatalogCached(onData?: (models: CatalogModel[], meta: CacheMeta) => void) {
    return appCache.swr({ policy: POLICIES.catalog, fetcher: () => observe(fetchCatalog()), onData });
}

export async function fetchCatalog(): Promise<CatalogModel[]> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE}/api/catalog`);
    } catch {
        throw new ApiError(0, 'network');
    }
    if (!res.ok) throw new ApiError(res.status, 'catalog_unavailable');
    const body = (await res.json()) as { models?: CatalogModel[] };
    return (body.models ?? []).filter(isSupported);
}

export interface GenerationRequest {
    // Explicit per-run rights for curated source flows; undefined preserves existing Create behavior.
    readonly sourceRights?: boolean;
    readonly modelId: string;
    // The text the person typed, sent under `textKey` (default `prompt`; Auto Short uses `topic`).
    readonly prompt: string;
    readonly textKey?: string;
    readonly durationSeconds: number | null;
    // The most the person was shown; the server refuses if the price differs.
    readonly confirmedCredits: number;
    // Reuse the same key to retry the same request: it is charged once.
    readonly idempotencyKey: string;
    // Files already uploaded, by the slot the model declares for them.
    readonly sources?: readonly { readonly key: string; readonly slot: string }[];
    // Library creations used as files, by the slot the model declares for them (ADR-0190).
    readonly assets?: readonly { readonly assetId: string; readonly slot: string }[];
    // Options the model's catalog entry declares (aspect_ratio, seed, negative_prompt). The server validates each again.
    readonly extraInputs?: Readonly<Record<string, string | number | boolean>>;
}

export const mediaApi = (api: ApiClient) => ({
    createGeneration: async (r: GenerationRequest) => {
        if (r.sourceRights === false) throw new ApiError(400, 'consent_required');
        await ensureOnline();
        // Ask first, so the consent sent with a file below is the person's stored agreement and never assumed.
        await aiConsent.ensure('/api/v1/generations', 'POST');
        const agreed = await aiConsent.hasAgreed();
        return api.request<{ job_id: string; balance_after?: number }>('/api/v1/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model_id: r.modelId,
                idempotency_key: r.idempotencyKey,
                confirmed_credits: r.confirmedCredits,
                inputs: { ...r.extraInputs, ...(r.prompt ? { [r.textKey ?? 'prompt']: r.prompt } : {}), ...(r.durationSeconds ? { duration_seconds: r.durationSeconds } : {}) },
                // The server refuses uploaded sources without consent to send them to the provider.
                ...(r.sources?.length ? { source_keys: r.sources } : {}),
                ...(r.assets?.length ? { source_assets: r.assets.map((a) => ({ asset_id: a.assetId, slot: a.slot })) } : {}),
                ...(r.sources?.length || r.assets?.length ? { consent: r.sourceRights === undefined ? agreed : r.sourceRights && agreed } : {}),
            }),
        });
    },
    getJob: (id: string) =>
        api.request<{ state: JobState; credits: number; model_id: string; error_code?: string; refunded?: boolean }>(`/api/v1/jobs/${encodeURIComponent(id)}`),
    listJobs: (cursor?: JobPage['next']) => {
        const q = new URLSearchParams({ limit: '24' });
        if (cursor) {
            q.set('before', cursor.before);
            q.set('before_id', cursor.before_id);
        }
        return api.request<JobPage>(`/api/v1/jobs?${q.toString()}`);
    },
    // What Veyrnox.ai records about how a stored file was made. 409 while the job has no stored output.
    getProvenance: (id: string) => api.request<unknown>(`/api/v1/jobs/${encodeURIComponent(id)}/provenance`),
    // A short-lived link (15 minutes): fetch it when needed, never store it.
    // A stem-splitting job lists its six labels in `output_stems`; `stem` asks for one of them.
    getAsset: (id: string, stem?: string) =>
        api.request<{ url: string; mime_type: string; asset_expires_at?: string; output_stems?: string[] }>(
            `/api/v1/jobs/${encodeURIComponent(id)}/asset${stem ? `?stem=${encodeURIComponent(stem)}` : ''}`,
        ),
});

const POLL_MS = 3000;
const POLL_LIMIT_MS = 10 * 60 * 1000;

// Polls a job until it succeeds or fails. Resolves with the last state; rejects only on a real error.
export async function waitForJob(
    api: ReturnType<typeof mediaApi>,
    id: string,
    onState: (state: JobState) => void,
    signal: AbortSignal,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<JobState> {
    const started = Date.now();
    let last: JobState = 'queued';
    while (!signal.aborted && Date.now() - started < POLL_LIMIT_MS) {
        last = (await api.getJob(id)).state;
        onState(last);
        if (last === 'succeeded' || last === 'failed') return last;
        await sleep(POLL_MS);
    }
    return last;
}
