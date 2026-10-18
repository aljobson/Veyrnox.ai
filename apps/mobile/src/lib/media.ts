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
        // Present on stem-splitting models, which the server serves only behind a flag.
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

// A model the app can drive: open, a kind it can show, every file slot a slot it can pick for,
// and something to send (a prompt, or at least one required file). Stem splitting is held back
// because the server answers it with audio_stems_unavailable unless its flag is on.
export function isSupported(model: CatalogModel): boolean {
    if (model.gated || kindOf(model.modality) === null) return false;
    const caps = model.capabilities;
    if (!caps || caps.outputStems) return false;
    const media = caps.media ?? {};
    if (!Object.keys(media).every((slot) => KNOWN_SLOTS.includes(slot))) return false;
    const hasPrompt = !!caps.inputs && 'prompt' in caps.inputs;
    return hasPrompt || Object.values(media).some((slot) => slot.required);
}

// Text-to-X models need words; edit and file-driven models take them as an optional extra.
export function promptRequired(model: CatalogModel): boolean {
    const caps = model.capabilities;
    if (!caps?.inputs || !('prompt' in caps.inputs)) return false;
    return !Object.values(caps.media ?? {}).some((slot) => slot.required);
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
    readonly modelId: string;
    readonly prompt: string;
    readonly durationSeconds: number | null;
    // The most the person was shown; the server refuses if the price differs.
    readonly confirmedCredits: number;
    // Reuse the same key to retry the same request: it is charged once.
    readonly idempotencyKey: string;
    // Files already uploaded, by the slot the model declares for them.
    readonly sources?: readonly { readonly key: string; readonly slot: string }[];
}

export const mediaApi = (api: ApiClient) => ({
    createGeneration: (r: GenerationRequest) =>
        api.request<{ job_id: string; balance_after?: number }>('/api/v1/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model_id: r.modelId,
                idempotency_key: r.idempotencyKey,
                confirmed_credits: r.confirmedCredits,
                inputs: { ...(r.prompt ? { prompt: r.prompt } : {}), ...(r.durationSeconds ? { duration_seconds: r.durationSeconds } : {}) },
                // The server refuses uploaded sources without consent to send them to the provider.
                ...(r.sources?.length ? { source_keys: r.sources, consent: true } : {}),
            }),
        }),
    getJob: (id: string) =>
        api.request<{ state: JobState; credits: number; model_id: string; error_code?: string }>(`/api/v1/jobs/${encodeURIComponent(id)}`),
    listJobs: (cursor?: JobPage['next']) => {
        const q = new URLSearchParams({ limit: '24' });
        if (cursor) {
            q.set('before', cursor.before);
            q.set('before_id', cursor.before_id);
        }
        return api.request<JobPage>(`/api/v1/jobs?${q.toString()}`);
    },
    // A short-lived link (15 minutes): fetch it when needed, never store it.
    getAsset: (id: string) =>
        api.request<{ url: string; mime_type: string; asset_expires_at?: string }>(`/api/v1/jobs/${encodeURIComponent(id)}/asset`),
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
