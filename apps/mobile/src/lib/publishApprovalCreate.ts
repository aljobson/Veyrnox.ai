import type { ApiClient } from './api';
import { ApiError } from './api';
import { isLinkOnOrigin } from './bearerLink';
import { MAX_TEXT, networkLabel, networkTextProblem, type MediaType, type YoutubeVisibility } from './publishCompose';
import { t } from './i18n';

// ADR-0238: ask outside reviewers to approve a post. The server schedules the post once the policy is met and answers
// with one private review link per reviewer. A link is a bearer link: it is shown once, on the screen that made the
// request, and handed to the system share sheet only when the person taps Share. It is never stored, logged or kept in
// the list (the approvals list still drops links on purpose, ADR-0135).

export type Policy = 'any' | 'all';
export const MAX_REVIEWERS = 10;
const EMAIL_RE = /^[^\s<>@]{1,64}@[^\s<>@]{1,185}\.[^\s<>@]{1,63}$/;
const MIN_LEAD_MS = 60_000;

export interface ApprovalDraft {
    readonly jobId: string;
    readonly mediaType: MediaType;
    readonly accountIds: readonly string[];
    readonly text: string;
    readonly scheduledAt: Date;
    readonly reviewers: readonly string[];
    readonly policy: Policy;
    readonly networkText?: Readonly<Record<string, string>>;
    readonly youtubeVisibility?: YoutubeVisibility;
}

// "a@x.test, B@x.test" -> unique lowercase addresses; anything that is not an address is reported.
export function parseReviewers(text: string): { emails: string[]; rejected: string[] } {
    const emails: string[] = [];
    const rejected: string[] = [];
    for (const part of text.split(/[,;\s]+/)) {
        const e = part.trim().toLowerCase();
        if (!e) continue;
        if (e.length > 254 || !EMAIL_RE.test(e)) rejected.push(part.trim());
        else if (!emails.includes(e)) emails.push(e);
    }
    return { emails, rejected };
}

// A key into the catalog for what is wrong, or null.
export function validateApproval(d: ApprovalDraft, now: Date): string | null {
    if (!d.jobId) return 'approvals.err.creation';
    if (d.accountIds.length === 0) return 'approvals.err.accounts';
    if (d.text.length > MAX_TEXT) return 'approvals.err.text';
    if (networkTextProblem(d.networkText)) return 'publishLinks.err.variantTooLong';
    if (d.reviewers.length < 1 || d.reviewers.length > MAX_REVIEWERS) return 'approvals.err.reviewers';
    if (d.scheduledAt.getTime() <= now.getTime() + MIN_LEAD_MS) return 'approvals.err.time';
    return null;
}

export const signatureOf = (d: ApprovalDraft): string =>
    JSON.stringify(['approval', d.jobId, d.mediaType, [...d.accountIds].sort(), d.text.trim(), d.scheduledAt.toISOString(), [...d.reviewers].sort(), d.policy,
        ...(Object.keys(d.networkText ?? {}).length > 0 || d.youtubeVisibility ? [Object.entries(d.networkText ?? {}).sort(([a], [b]) => a.localeCompare(b)), d.youtubeVisibility ?? null] : []),
    ]);

export function approvalBody(d: ApprovalDraft, idempotencyKey: string): Record<string, unknown> {
    return {
        scheduledAt: d.scheduledAt.toISOString(),
        globalText: d.text.trim(),
        idempotencyKey,
        accountIds: [...d.accountIds],
        media: [{ mediaType: d.mediaType, jobId: d.jobId }],
        reviewers: [...d.reviewers],
        policy: d.policy,
        ...(d.networkText && Object.keys(d.networkText).length > 0 ? { networkText: d.networkText } : {}),
        ...(d.youtubeVisibility ? { youtubeVisibility: d.youtubeVisibility } : {}),
    };
}

export function approvalConfirmExtra(networkText?: Readonly<Record<string, string>>, youtubeVisibility?: YoutubeVisibility): string[] {
    const lines = Object.entries(networkText ?? {}).map(([network, text]) => {
        const points = [...text];
        return t('publishLinks.confirmVariant', { network: networkLabel(network), text: points.slice(0, 60).join('') + (points.length > 60 ? '…' : '') });
    });
    const visibilityKeys = { private: 'compose.youtube.private', unlisted: 'compose.youtube.unlisted', public: 'compose.youtube.public' } as const;
    if (youtubeVisibility) lines.push(t('publishLinks.confirmYoutube', { visibility: t(visibilityKeys[youtubeVisibility]) }));
    return lines;
}

export interface ReviewLink {
    readonly email: string;
    readonly url: string;
}

export interface Created {
    readonly requestId: string;
    readonly idempotent: boolean;
    readonly links: ReviewLink[];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// Only a link on the app's own API origin, https, with path /social/review/..., is kept (see bearerLink.ts).
export function isReviewLink(url: unknown, base?: string): url is string {
    return isLinkOnOrigin(url, '/social/review/', base);
}

export function parseCreated(body: unknown): Created {
    const b = isObject(body) ? body : {};
    const links: ReviewLink[] = [];
    for (const raw of Array.isArray(b.review_links) ? b.review_links : []) {
        if (!isObject(raw) || typeof raw.email !== 'string' || typeof raw.url !== 'string') continue;
        if (isReviewLink(raw.url)) links.push({ email: raw.email.slice(0, 254), url: raw.url });
    }
    return { requestId: typeof b.request_id === 'string' ? b.request_id : '', idempotent: b.idempotent === true, links };
}

export async function createApproval(api: ApiClient, d: ApprovalDraft, key: string): Promise<Created> {
    const res = await api.request('/api/v1/social/approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(approvalBody(d, key)) });
    return parseCreated(res);
}

export function variantsUnavailable(err: unknown): boolean {
    if (!(err instanceof ApiError)) return false;
    return (err.status === 402 && (err.body.feature === 'platform_variants' || err.code === 'publish_plan_required'))
        || (err.status === 404 && err.code === 'variants_not_open')
        || (err.status === 503 && err.code === 'variants_not_configured');
}

export function approvalCreateErrorKey(err: unknown): string {
    if (variantsUnavailable(err)) return 'publishLinks.err.variantsOff';
    if (!(err instanceof ApiError)) return 'approvals.err.later';
    if (err.status === 0) return 'approvals.err.createNetwork';
    if (err.status === 402) return 'approvals.err.plan';
    if (err.status === 403) return 'approvals.err.role';
    if (err.status === 404) return err.code === 'approvals_not_open' ? 'approvals.err.notOpen' : 'approvals.err.accountGone';
    if (err.status === 429) return 'approvals.err.rate';
    if (err.code === 'INVALID_REVIEWERS') return 'approvals.err.reviewers';
    if (err.status === 400 && err.code === 'caption_too_long') return 'publishLinks.err.variantTooLong';
    if (err.status === 400) return 'approvals.err.invalid';
    return 'approvals.err.later';
}
