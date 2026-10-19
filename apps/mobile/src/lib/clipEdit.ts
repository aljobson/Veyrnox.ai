import { ApiError, type ApiClient } from './api';
import { ensureOnline } from './network';

// ADR-0134: quick edit. Trim and join the person's own finished videos (Library jobs), with optional captions, as one
// priced 'clip-edit' generation. Limits mirror lib/clipEdit.js on the server, which judges every request again and
// refuses a bad one before any charge. The price is never computed here: it is read from the server's own quote.

export const CLIP_EDIT_MODEL = 'clip-edit';
export const MAX_CLIPS = 10;
export const MAX_OUTPUT_S = 60;
export const STEP_S = 0.5;
export const MIN_CLIP_S = 0.5;
// The server allows an end up to 0.05 s past the real length; this side keeps inside it.
const EPSILON = 0.05;

export const CAPTION_PRESETS = [
    'glass', 'whisper', 'glide2', 'fusion', 'glide', 'terminal', 'handwritten', 'backdrop', 'backdrop2', 'simple',
    'plain', 'beans', 'corpo', 'boo', 'shadeplay', 'casper', 'capri', 'lowkey', 'vinta', 'diego', 'ali', 'slay',
    'kitty', 'hustle', 'karl', 'sprout', 'flex', 'mint', 'rizz', 'vegas',
] as const;
export const DEFAULT_CAPTION_PRESET = 'simple';

export interface Clip {
    readonly jobId: string;
    readonly label: string;
    // The video's real length in seconds, read from the video itself; null when it could not be read.
    readonly length: number | null;
    readonly start: number;
    readonly end: number;
}

// A sound laid under the video: one of the person's own audio creations, starting `offset` seconds in (ADR-0157).
export interface AudioTrack {
    readonly jobId: string;
    readonly label: string;
    readonly offset: number;
}

export const newAudio = (source: { readonly jobId: string; readonly label: string }): AudioTrack => ({ jobId: source.jobId, label: source.label, offset: 0 });

// The sound may start anywhere inside the video, not at or after its end (the server's audio_invalid).
export function stepOffset(a: AudioTrack, delta: number, total: number): AudioTrack {
    const top = Math.max(0, round2(total - STEP_S));
    return { ...a, offset: round2(clamp(a.offset + delta, 0, top)) };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const floor1 = (n: number): number => Math.floor(n * 10 + 1e-9) / 10;
const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

export function newClip(source: { readonly jobId: string; readonly label: string }, length: number | null): Clip {
    const end = length === null ? 0 : Math.min(floor1(length), MAX_OUTPUT_S);
    return { jobId: source.jobId, label: source.label, length, start: 0, end };
}

// The video's real length from the server (GET /api/v1/jobs/:id/media-info, read from the stored file's own headers),
// so adding a clip needs no file link and no player. Any failure (not found, not a video, unreadable, rate limited,
// offline) or an answer that is not a positive number returns null: the screen then reads the length with the player
// instead, as before. Nothing here is charged or changes anything.
export async function fetchClipLength(api: ApiClient, jobId: string): Promise<number | null> {
    try {
        const res = await api.request<{ seconds?: unknown } | null>(`/api/v1/jobs/${encodeURIComponent(jobId)}/media-info`);
        const s = res?.seconds;
        return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : null;
    } catch {
        return null;
    }
}

export function stepStart(c: Clip, delta: number): Clip {
    return { ...c, start: round2(clamp(c.start + delta, 0, Math.max(0, c.end - MIN_CLIP_S))) };
}

export function stepEnd(c: Clip, delta: number): Clip {
    const top = c.length === null ? c.end : floor1(c.length);
    return { ...c, end: round2(clamp(c.end + delta, Math.min(c.start + MIN_CLIP_S, top), top)) };
}

export function moveClip(clips: readonly Clip[], index: number, dir: -1 | 1): Clip[] {
    const to = index + dir;
    if (index < 0 || index >= clips.length || to < 0 || to >= clips.length) return [...clips];
    const out = [...clips];
    const [moved] = out.splice(index, 1);
    out.splice(to, 0, moved as Clip);
    return out;
}

export const clipSeconds = (c: Clip): number => Math.max(0, round2(c.end - c.start));
export const totalSeconds = (clips: readonly Clip[]): number => round2(clips.reduce((n, c) => n + clipSeconds(c), 0));

export type EditProblem = 'audio_offset' | 'no_clips' | 'too_many' | 'unknown_length' | 'bad_range' | 'too_long' | 'nothing_to_do';

export function validateEdit(clips: readonly Clip[], captions: string | null, audio: AudioTrack | null = null): EditProblem | null {
    if (clips.length === 0) return 'no_clips';
    if (clips.length > MAX_CLIPS) return 'too_many';
    if (clips.some((c) => c.length === null)) return 'unknown_length';
    for (const c of clips) {
        if (!(c.start >= 0 && c.end > c.start && c.end <= (c.length as number) + EPSILON)) return 'bad_range';
    }
    if (totalSeconds(clips) > MAX_OUTPUT_S + EPSILON) return 'too_long';
    if (audio && !(audio.offset >= 0 && audio.offset < totalSeconds(clips))) return 'audio_offset';
    const only = clips[0] as Clip;
    if (clips.length === 1 && !captions && !audio && only.start === 0 && (only.length as number) - only.end < 0.15) return 'nothing_to_do';
    return null;
}

export function editBody(clips: readonly Clip[], captions: string | null, confirmedCredits: number, idempotencyKey: string, audio: AudioTrack | null = null): Record<string, unknown> {
    return {
        model_id: CLIP_EDIT_MODEL,
        idempotency_key: idempotencyKey,
        confirmed_credits: confirmedCredits,
        inputs: {
            clips: clips.map((c) => ({ asset_id: c.jobId, in_s: round2(c.start), out_s: round2(c.end) })),
            ...(audio ? { audio: { asset_id: audio.jobId, offset_s: round2(audio.offset) } } : {}),
            ...(captions ? { captions: { preset: captions } } : {}),
        },
    };
}

const post = (api: ApiClient, body: Record<string, unknown>) =>
    api.request<{ job_id?: string }>('/api/v1/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export type Quote = { readonly kind: 'quote'; readonly credits: number } | { readonly kind: 'created'; readonly jobId: string };

// The server's own quote: the same request pinned to 0 credits is refused with the real price and charges nothing. The
// edit is checked first, so a bad range or a missing file comes back here as that error, also uncharged.
export async function quoteEdit(api: ApiClient, clips: readonly Clip[], captions: string | null, idempotencyKey: string, audio: AudioTrack | null = null): Promise<Quote> {
    await ensureOnline();
    try {
        const res = await post(api, editBody(clips, captions, 0, idempotencyKey, audio));
        // The server accepted a price of 0 and made the job: say so rather than hide it.
        if (typeof res.job_id === 'string') return { kind: 'created', jobId: res.job_id };
        throw new ApiError(502, 'unexpected_quote');
    } catch (err) {
        const credits = priceChanged(err);
        if (credits !== null) return { kind: 'quote', credits };
        throw err;
    }
}

export async function submitEdit(api: ApiClient, clips: readonly Clip[], captions: string | null, credits: number, idempotencyKey: string, audio: AudioTrack | null = null): Promise<{ jobId: string }> {
    await ensureOnline();
    const res = await post(api, editBody(clips, captions, credits, idempotencyKey, audio));
    if (typeof res.job_id !== 'string') throw new ApiError(502, 'unexpected_submit');
    return { jobId: res.job_id };
}

// The price the server says it is now, when a send was refused because the price differs; otherwise null.
export function priceChanged(err: unknown): number | null {
    if (!(err instanceof ApiError) || err.status !== 409 || err.code !== 'credit_confirmation_mismatch') return null;
    const n = err.body.expected_credits;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

// Catalog keys for what the person should change, looked up when shown.
export function editErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'edit.err.network';
    if (err.status === 429) return 'edit.err.rate';
    if (err.status === 402 || err.code === 'insufficient_credits') return 'edit.err.credits';
    if (err.code.startsWith('inputs_invalid')) return 'edit.err.invalid';
    switch (err.code) {
        case 'consent_declined':
        case 'consent_required':
            return 'edit.err.consent';
        case 'clip_range':
            return 'edit.err.clipRange';
        case 'too_long':
            return 'edit.err.tooLong';
        case 'nothing_to_do':
            return 'edit.err.nothingToDo';
        case 'mixed_aspect':
            return 'edit.err.mixedAspect';
        case 'clip_not_video':
            return 'edit.err.notVideo';
        case 'clip_unreadable':
            return 'edit.err.unreadable';
        case 'asset_not_found':
            return 'edit.err.gone';
        case 'audio_not_audio':
            return 'edit.err.notAudio';
        case 'audio_invalid':
            return 'edit.problem.audio_offset';
        case 'captions_unavailable':
            return 'edit.err.captionsOff';
        default:
            return err.status >= 500 ? 'edit.err.busy' : 'common.error';
    }
}
