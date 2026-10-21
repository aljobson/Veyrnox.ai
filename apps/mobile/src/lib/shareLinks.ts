import { API_BASE, ApiError, type ApiClient } from './api';

// Two links people receive by message (parity P7): a team invitation to a Publish brand and a post review request.
// Both carry a signed token in the address. The token is checked for shape here and verified by the server; it is
// never logged. The invitation needs the person signed in; the review needs nothing but the token (as on the web).
const TOKEN_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,3}$/;
const MAX_TOKEN = 2048;
export const validToken = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_TOKEN && TOKEN_RE.test(value);

export function inviteTokenFromLink(text: unknown): string | null {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (trimmed.length > 2100) return null;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
        if (!['https://veyrnox.ai', 'https://www.veyrnox.ai', new URL(API_BASE).origin].includes(url.origin)) return null;
        const parts = url.pathname.split('/');
        return parts.length === 5 && parts[0] === '' && parts[1] === 'social' && parts[2] === 'team' && parts[3] === 'invite' && validToken(parts[4]) ? parts[4] : null;
    } catch {
        return null;
    }
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

// A read that needs no sign-in (the token is the credential).
async function publicRequest(path: string, init?: RequestInit): Promise<unknown> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE}${path}`, { cache: 'no-store', ...init });
    } catch {
        throw new ApiError(0, 'network');
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ApiError(res.status, typeof body.error === 'string' ? body.error : 'unknown', body);
    return body;
}

export interface Invite {
    readonly brandName: string;
    readonly email: string;
    readonly role: string;
    readonly status: string;
    readonly expiresAt: string | null;
}

export function parseInvite(body: unknown): Invite {
    const b = rec(body);
    return { brandName: str(b.brand_name) ?? '', email: str(b.email) ?? '', role: str(b.role) ?? '', status: str(b.status) ?? '', expiresAt: str(b.expires_at) };
}

export async function fetchInvite(token: string): Promise<Invite> {
    if (!validToken(token)) throw new ApiError(404, 'invalid_or_expired_link');
    return parseInvite(await publicRequest(`/api/social/team/${encodeURIComponent(token)}`));
}

// An invitation can be accepted only while it is waiting; the server decides, this just avoids a pointless call.
export const inviteOpen = (i: Invite): boolean => i.status === '' || i.status === 'pending';

export function inviteState(i: Invite, now: Date): 'open' | 'accepted' | 'revoked' | 'expired' | 'closed' {
    if (i.status === 'accepted' || i.status === 'revoked' || i.status === 'expired') return i.status;
    if (i.status === '' || i.status === 'pending') {
        return i.expiresAt && Date.parse(i.expiresAt) <= now.getTime() ? 'expired' : 'open';
    }
    return 'closed';
}

export async function acceptInvite(api: Pick<ApiClient, 'request'>, token: string): Promise<{ brandId: string | null; role: string | null; idempotent: boolean }> {
    if (!validToken(token)) throw new ApiError(404, 'invalid_or_expired_link');
    const out = rec(await api.request('/api/v1/social/team/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }));
    return { brandId: str(out.brand_id), role: str(out.role), idempotent: out.idempotent === true };
}

export type InviteErrorKey = 'share.invite.err.email' | 'share.invite.err.gone' | 'share.invite.err.off' | 'share.err.network' | 'share.invite.err.failed' | 'publishLinks.teamJoin.err.unavailable' | 'publishLinks.teamJoin.err.rate';

export function inviteErrorKey(err: unknown): InviteErrorKey {
    if (err instanceof ApiError) {
        if (err.status === 0) return 'share.err.network';
        if (err.status === 403 || err.code === 'EMAIL_MISMATCH') return 'share.invite.err.email';
        if (err.status === 404) return err.code === 'teams_not_open' || err.code === 'not_found' ? 'share.invite.err.off' : 'share.invite.err.gone';
        if (err.status === 400 && err.code === 'INVITE_UNAVAILABLE') return 'publishLinks.teamJoin.err.unavailable';
        if (err.status === 429) return 'publishLinks.teamJoin.err.rate';
        if (err.status === 503) return 'share.invite.err.off';
    }
    return 'share.invite.err.failed';
}

export interface ReviewTarget {
    readonly network: string;
    readonly text: string;
}

export interface Review {
    readonly brandName: string;
    readonly networks: readonly string[];
    readonly targets: readonly ReviewTarget[];
    readonly globalText: string;
    readonly scheduledAt: string | null;
    readonly policy: string;
    readonly decision: string;
    readonly requestStatus: string;
    readonly mediaType: string | null;
    readonly previewUrl: string | null;
}

// The preview address is a path on our own server: it is joined to the app's host, never used as given.
export function previewUrl(path: unknown): string | null {
    return typeof path === 'string' && /^\/media\/social\/[A-Za-z0-9_.%-]+$/.test(path) && path.length < 2048 ? `${API_BASE}${path}` : null;
}

export function parseReview(body: unknown): Review {
    const b = rec(body);
    const media = rec(b.media);
    const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const targets = (Array.isArray(b.targets) ? b.targets : []).flatMap((raw) => {
        const t = rec(raw);
        return str(t.network) ? [{ network: t.network as string, text: typeof t.text === 'string' ? t.text : '' }] : [];
    });
    return {
        brandName: str(b.brand_name) ?? '',
        networks: strList(b.networks),
        targets,
        globalText: typeof b.global_text === 'string' ? b.global_text : '',
        scheduledAt: str(b.scheduled_at),
        policy: str(b.policy) ?? 'one',
        decision: str(b.decision) ?? 'pending',
        requestStatus: str(b.request_status) ?? 'pending',
        mediaType: str(media.media_type),
        previewUrl: previewUrl(media.preview_url),
    };
}

export async function fetchReview(token: string): Promise<Review> {
    if (!validToken(token)) throw new ApiError(404, 'invalid_or_expired_link');
    return parseReview(await publicRequest(`/api/social/approvals/${encodeURIComponent(token)}`));
}

export const reviewOpen = (r: Review): boolean => r.decision === 'pending' && r.requestStatus === 'pending';
export const COMMENT_MAX = 2000;

export async function decideReview(token: string, decision: 'approved' | 'rejected', comment: string): Promise<{ decision: string; requestStatus: string }> {
    if (!validToken(token)) throw new ApiError(404, 'invalid_or_expired_link');
    if (comment.length > COMMENT_MAX) throw new ApiError(400, 'invalid_decision');
    const out = rec(await publicRequest(`/api/social/approvals/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, comment: comment.trim() || undefined }) }));
    return { decision: str(out.decision) ?? decision, requestStatus: str(out.request_status) ?? '' };
}

export type ReviewErrorKey = 'share.review.err.gone' | 'share.err.network' | 'share.review.err.failed';

export function reviewErrorKey(err: unknown): ReviewErrorKey {
    if (err instanceof ApiError) {
        if (err.status === 0) return 'share.err.network';
        if (err.status === 404) return 'share.review.err.gone';
    }
    return 'share.review.err.failed';
}
