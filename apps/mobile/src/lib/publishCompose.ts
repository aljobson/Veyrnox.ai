import type { ApiClient } from './api';
import { t } from './i18n';
import { kindOf } from './media';
import type { PublishAccount } from './publish';

// ADR-0122: the Publish composer. Everything that decides what is sent lives here so it can be tested;
// the server stays the authority on every rule (plan, networks, media), these checks only save a round trip.

export type MediaType = 'image' | 'video';
export const MAX_TEXT = 4000;
const MIN_LEAD_MS = 60_000;

// Caption limits by network, as a hint only (the server enforces its own). Mirrors lib/social/networks.js.
const CAPTION_LIMIT: Record<string, { label: string; limit: number }> = {
    instagram: { label: 'Instagram', limit: 2200 },
    linkedin: { label: 'LinkedIn', limit: 3000 },
    twitter: { label: 'X', limit: 280 },
    tiktok: { label: 'TikTok', limit: 2200 },
    youtube: { label: 'YouTube', limit: 4000 },
    facebook: { label: 'Facebook', limit: 4000 },
    threads: { label: 'Threads', limit: 500 },
    pinterest: { label: 'Pinterest', limit: 800 },
    bluesky: { label: 'Bluesky', limit: 300 },
    gmb: { label: 'Google Business Profile', limit: 1500 },
};

export type When = { readonly kind: 'now' } | { readonly kind: 'at'; readonly at: Date };

export type YoutubeVisibility = 'private' | 'unlisted' | 'public';
export const YOUTUBE_VISIBILITIES: readonly YoutubeVisibility[] = ['private', 'unlisted', 'public'];

export interface Draft {
    readonly jobId: string;
    readonly uploadId?: string;
    readonly mediaType: MediaType;
    readonly accountIds: readonly string[];
    readonly text: string;
    readonly when: When;
    // ADR-0161: own text for some networks (network key -> text), YouTube visibility, and the queue whose next slot
    // sets the time (then `when` is a placeholder until the slot is reserved).
    readonly networkText?: Readonly<Record<string, string>>;
    readonly youtubeVisibility?: YoutubeVisibility;
    readonly queue?: { readonly id: string; readonly name: string };
}

export const captionLimit = (network: string): number | null => CAPTION_LIMIT[network]?.limit ?? null;
export const networkLabel = (network: string): string => CAPTION_LIMIT[network]?.label ?? network;

// Keeps only non-empty text for networks that are chosen; the server refuses text for any other network.
export function cleanNetworkText(variants: Readonly<Record<string, string>>, networks: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const n of networks) {
        const v = variants[n];
        if (typeof v === 'string' && v.trim()) out[n] = v;
    }
    return out;
}

export function mediaTypeOf(modality: string): MediaType | null {
    const kind = kindOf(modality);
    return kind === 'image' || kind === 'video' ? kind : null;
}

export const eligibleAccounts = (accounts: readonly PublishAccount[], media: MediaType): PublishAccount[] =>
    accounts.filter((a) => a.status === 'active' && a.publishingEnabled && a.supportedMedia.includes(media));

export function captionWarning(text: string, networks: readonly string[]): string | null {
    for (const n of networks) {
        const c = CAPTION_LIMIT[n];
        if (c && text.length > c.limit) return `${c.label} allows ${c.limit} characters; this is ${text.length}.`;
    }
    return null;
}

// Local date "YYYY-MM-DD" and time "HH:MM". Impossible dates (31 February, 25:00) are null.
export function parseWhen(date: string, time: string): Date | null {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!d || !t) return null;
    const [y, mo, da, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
    const out = new Date(y, mo - 1, da, h, mi);
    const same = out.getFullYear() === y && out.getMonth() === mo - 1 && out.getDate() === da && out.getHours() === h && out.getMinutes() === mi;
    return same ? out : null;
}

export function quickTimes(now: Date): { label: string; date: Date }[] {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
    return [
        { label: 'In 1 hour', date: new Date(now.getTime() + 3_600_000) },
        { label: 'Tomorrow 9:00', date: tomorrow },
        { label: 'In 1 week', date: new Date(now.getTime() + 7 * 86_400_000) },
    ];
}

export function validateDraft(draft: Draft, accounts: readonly PublishAccount[], now: Date): string | null {
    if (!!draft.jobId === !!draft.uploadId) return 'Choose a creation to post.';
    if (draft.accountIds.length === 0) return 'Choose at least one account.';
    if (draft.text.length > MAX_TEXT) return `The text can be at most ${MAX_TEXT} characters.`;
    for (const id of draft.accountIds) {
        const a = accounts.find((x) => x.id === id);
        if (!a || !a.supportedMedia.includes(draft.mediaType)) return `${a?.displayName ?? 'That account'} cannot post a ${draft.mediaType}.`;
    }
    for (const [network, v] of Object.entries(draft.networkText ?? {})) {
        const limit = captionLimit(network);
        if (limit !== null && [...v].length > limit) return `${networkLabel(network)} allows ${limit} characters; this is ${[...v].length}.`;
    }
    if (!draft.queue && draft.when.kind === 'at' && draft.when.at.getTime() <= now.getTime() + MIN_LEAD_MS) return 'Choose a time in the future (at least a minute away).';
    return null;
}

// Body for POST /api/v1/social/posts. Post now uses the server's clock, so the device's time never matters.
export function createBody(draft: Draft, idempotencyKey: string, _now: Date): Record<string, unknown> {
    return {
        ...(draft.when.kind === 'now' ? { publishNow: true } : { scheduledAt: draft.when.at.toISOString() }),
        globalText: draft.text.trim(),
        ...(draft.networkText && Object.keys(draft.networkText).length > 0 ? { networkText: draft.networkText } : {}),
        ...(draft.youtubeVisibility ? { youtubeVisibility: draft.youtubeVisibility } : {}),
        idempotencyKey,
        accountIds: [...draft.accountIds],
        media: [{ mediaType: draft.mediaType, ...(draft.uploadId ? { uploadId: draft.uploadId } : { jobId: draft.jobId }) }],
    };
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const postPath = (id: string) => `/api/v1/social/posts/${encodeURIComponent(id)}`;

export async function createPost(api: ApiClient, body: Record<string, unknown>): Promise<{ postId: string; idempotent: boolean; targetCount: number }> {
    const r = await api.request<{ post_id?: string; idempotent?: boolean; target_count?: number }>('/api/v1/social/posts', json('POST', body));
    return { postId: String(r.post_id ?? ''), idempotent: r.idempotent === true, targetCount: Number(r.target_count ?? 0) };
}

export const reschedulePost = (api: ApiClient, id: string, expectedAt: string, scheduledAt: Date) =>
    api.request<{ scheduled_at?: string }>(`${postPath(id)}/schedule`, json('PATCH', { scheduledAt: scheduledAt.toISOString(), expectedAt }));

export const cancelPost = (api: ApiClient, id: string, expectedUpdatedAt: string) =>
    api.request<{ updated_at?: string }>(postPath(id), json('PATCH', { action: 'cancel', expectedUpdatedAt }));

export const restorePost = (api: ApiClient, id: string, expectedUpdatedAt: string, scheduledAt: Date) =>
    api.request<{ updated_at?: string; scheduled_at?: string }>(postPath(id), json('PATCH', { action: 'restore', expectedUpdatedAt, scheduledAt: scheduledAt.toISOString() }));

export function composeErrorMessage(err: unknown, isUpload = false): string {
    const e = err as { status?: number; code?: string; body?: Record<string, unknown> } | null;
    const status = typeof e?.status === 'number' ? e.status : -1;
    const code = String(e?.code ?? '');
    if (isUpload && (code === 'MEDIA_NOT_FOUND' || (status === 400 && code === 'invalid_media'))) return t('publishUploads.unavailable');
    if (status === 0) return 'No connection. Nothing was posted. Check your internet and try again.';
    if (status === 402) {
        const feature = e?.body?.feature;
        if (feature === 'scheduling') return 'Scheduling needs the Publish Plan. You can still post now.';
        if (feature === 'platform_variants') return 'Different text for each network needs the Publish Plan.';
        if (feature === 'multiple_accounts') return 'Posting to more than one account needs the Publish Plan.';
        return 'This needs the Publish Plan.';
    }
    if (status === 403) return 'You do not have permission to do that for this brand.';
    if (code === 'variants_not_open' || code === 'variants_not_configured') return 'Different text for each network is not open yet. Remove it and try again.';
    if (code === 'youtube_visibility_not_open') return 'Choosing YouTube visibility is not open yet. Remove it and try again.';
    if (code === 'caption_too_long') return 'The text is too long for one of the networks.';
    if (code === 'unsupported_media_type') return 'One of the chosen networks cannot post this creation.';
    if (code === 'network_unavailable') return 'One of the chosen networks is not open for posting yet.';
    if (code === 'POST_NOT_FOUND') return 'That post is no longer there.';
    if (code === 'ACCOUNT_NOT_FOUND') return 'One of the chosen accounts is no longer connected.';
    if (code === 'MEDIA_NOT_FOUND') return 'That creation could not be found or has no file yet.';
    if (code === 'POST_STARTED') return 'This post has already started publishing, so it cannot be changed.';
    if (code === 'SCHEDULE_CHANGED' || status === 409) return 'This post changed somewhere else. Reload it and try again.';
    if (status === 503 && code === 'calendar_not_open') return 'Changing scheduled posts is not available yet.';
    if (status === 429) return 'Too many requests. Try again in a moment.';
    if (status === 400) return 'The server did not accept that. Check the details and try again.';
    return 'Something went wrong. Nothing was posted. Try again.';
}
