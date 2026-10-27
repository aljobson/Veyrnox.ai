import type { ApiClient } from './api';
import { t } from './i18n';
import { kindOf } from './media';
import type { PublishAccount } from './publish';

// ADR-0122: the Publish composer. Everything that decides what is sent lives here so it can be tested;
// the server stays the authority on every rule (plan, networks, media), these checks only save a round trip.

export type { MediaType } from './publishMediaSignature';
import type { MediaType } from './publishMediaSignature';
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

export { draftMedia, mediaSignature } from './publishMediaSignature';
export type { MediaDraft, PostMedia } from './publishMediaSignature';
import { draftMedia, type MediaDraft, type PostMedia } from './publishMediaSignature';
export function mediaBlocker(items: readonly PostMedia[], accounts: readonly PublishAccount[]): string | null {
    for (const account of accounts) {
        if (items.length > 1 && (!account.carousel || items.length > account.carousel.max
            || items.some(item => !account.carousel?.types.includes(item.mediaType)))) return account.network;
        if (items.some(item => !account.supportedMedia.includes(item.mediaType))) return account.network;
    }
    return null;
}

export interface Draft {
    readonly media?: readonly PostMedia[];
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

export function networkTextProblem(networkText?: Readonly<Record<string, string>>): { network: string; limit: number; length: number } | null {
    for (const [network, v] of Object.entries(networkText ?? {})) {
        const limit = captionLimit(network);
        const length = [...v].length;
        if (limit !== null && length > limit) return { network, limit, length };
    }
    return null;
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
        { label: t('publishCompose.in1hour'), date: new Date(now.getTime() + 3_600_000) },
        { label: t('publishCompose.tomorrow900'), date: tomorrow },
        { label: t('publishCompose.in1week'), date: new Date(now.getTime() + 7 * 86_400_000) },
    ];
}

export function validateDraft(draft: Draft, accounts: readonly PublishAccount[], now: Date): string | null {
    const media = draftMedia(draft);
    if ((!draft.media && !!draft.jobId === !!draft.uploadId) || !media.length || media.length > 10 || media.some(item => !!item.jobId === !!item.uploadId)) return t('publishCompose.chooseacreationtopost');
    const blocker = media.length > 1 && mediaBlocker(media, accounts.filter(account => draft.accountIds.includes(account.id)));
    if (blocker) return t('app.publish.carousel.blocked', { network: networkLabel(blocker) });
    if (draft.accountIds.length === 0) return t('publishCompose.chooseatleastoneaccount');
    if (draft.text.length > MAX_TEXT) return t('publishCompose.thetextcanbeatmostcharacters', { value1: MAX_TEXT });
    for (const id of draft.accountIds) {
        const a = accounts.find((x) => x.id === id);
        if (!a || media.some(item => !a.supportedMedia.includes(item.mediaType))) return `${a?.displayName ?? 'That account'} cannot post a ${draft.mediaType}.`;
    }
    const problem = networkTextProblem(draft.networkText);
    if (problem) return `${networkLabel(problem.network)} allows ${problem.limit} characters; this is ${problem.length}.`;
    if (!draft.queue && draft.when.kind === 'at' && draft.when.at.getTime() <= now.getTime() + MIN_LEAD_MS) return t('publishCompose.chooseatimeinthefutureat');
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
        media: draftMedia(draft),
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
    if (status === 0) return t('publishCompose.noconnectionNothingwaspostedCheckyour');
    if (status === 402) {
        const feature = e?.body?.feature;
        if (feature === 'scheduling') return t('publishCompose.schedulingneedsthePublishPlanYoucan');
        if (feature === 'platform_variants') return t('publishCompose.differenttextforeachnetworkneedsthe');
        if (feature === 'multiple_accounts') return t('publishCompose.postingtomorethanoneaccountneeds');
        return t('publishCompose.thisneedsthePublishPlan');
    }
    if (status === 403) return t('publishCompose.youdonothavepermissiontodo');
    if (code === 'variants_not_open' || code === 'variants_not_configured') return t('publishCompose.differenttextforeachnetworkisnot');
    if (code === 'youtube_visibility_not_open') return t('publishCompose.choosingYouTubevisibilityisnotopenyet');
    if (code === 'caption_too_long') return t('publishCompose.thetextistoolongforone');
    if (code === 'carousel_not_open') return t('app.publish.carousel.closed');
    if (code === 'media_count_not_supported') return t('app.publish.carousel.blocked', { network: networkLabel(String(e?.body?.network || '')) });
    if (code === 'unsupported_media_type') return t('publishCompose.oneofthechosennetworkscannotpost');
    if (code === 'network_unavailable') return t('publishCompose.oneofthechosennetworksisnot');
    if (code === 'POST_NOT_FOUND') return t('publishCompose.thatpostisnolongerthere');
    if (code === 'ACCOUNT_NOT_FOUND') return t('publishCompose.oneofthechosenaccountsisno');
    if (code === 'MEDIA_NOT_FOUND') return t('publishCompose.thatcreationcouldnotbefoundor');
    if (code === 'POST_STARTED') return t('publishCompose.thisposthasalreadystartedpublishingso');
    if (code === 'SCHEDULE_CHANGED' || status === 409) return t('publishCompose.thispostchangedsomewhereelseReloadit');
    if (status === 503 && code === 'calendar_not_open') return t('publishCompose.changingscheduledpostsisnotavailableyet');
    if (status === 429) return t('publishCompose.toomanyrequestsTryagainina');
    if (status === 400) return t('publishCompose.theserverdidnotacceptthatCheck');
    return t('publishCompose.somethingwentwrongNothingwaspostedTry');
}
