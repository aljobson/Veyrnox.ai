import { ApiError, type ApiClient } from './api';
import { isUsername } from './cinemaBlocks';

// Cinema comments (ADR-0142), over GET and POST /api/v1/cinema/comments (ADR-0081). A person reads a title's comments,
// writes one (it waits for review before others see it), reports a comment, and can block its author. The server is
// the authority on every rule; the limits here only stop a request that would certainly be refused. Comment text is
// data: it is shown as plain text, never as markup or links.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BODY_MAX = 2000;
export const DETAILS_MIN = 3;
export const DETAILS_MAX = 500;

export const REPORT_CATEGORIES = [
    { key: 'spam', label: 'Spam' },
    { key: 'abuse', label: 'Abuse or harassment' },
    { key: 'privacy', label: 'Private information' },
    { key: 'rights', label: 'Copyright or rights' },
    { key: 'other', label: 'Something else' },
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]['key'];

const chars = (s: string) => [...s.trim()].length;
export const bodyOk = (s: unknown): s is string => typeof s === 'string' && chars(s) >= 1 && chars(s) <= BODY_MAX;
export const detailsOk = (s: unknown): s is string => typeof s === 'string' && chars(s) >= DETAILS_MIN && chars(s) <= DETAILS_MAX;

export interface Comment {
    readonly id: string;
    readonly body: string;
    readonly createdAt: string | null;
    // The author's handle, kept only when valid: it is what Block needs.
    readonly username: string | null;
    readonly displayName: string;
    readonly own: boolean;
}
export interface OwnComment {
    readonly id: string;
    readonly body: string;
    readonly status: string;
    readonly createdAt: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v : null);
const text = (v: unknown): string => (typeof v === 'string' ? v.slice(0, BODY_MAX) : '');
const when = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

export function parseComments(body: unknown): { comments: Comment[]; own: OwnComment[]; next: string | null } {
    const b = isObject(body) ? body : {};
    const comments: Comment[] = [];
    for (const raw of Array.isArray(b.comments) ? b.comments : []) {
        if (!isObject(raw)) continue;
        const id = uuid(raw.id);
        const t = text(raw.body);
        if (!id || !t.trim()) continue;
        const display = typeof raw.display_name === 'string' && raw.display_name.trim() ? raw.display_name.trim().slice(0, 80) : 'Member';
        comments.push({ id, body: t, createdAt: when(raw.created_at), username: isUsername(raw.username) ? raw.username : null, displayName: display, own: raw.own === true });
    }
    const own: OwnComment[] = [];
    for (const raw of Array.isArray(b.own_comments) ? b.own_comments : []) {
        if (!isObject(raw)) continue;
        const id = uuid(raw.id);
        const t = text(raw.body);
        if (!id || !t.trim()) continue;
        own.push({ id, body: t, status: typeof raw.status === 'string' ? raw.status : 'pending', createdAt: when(raw.created_at) });
    }
    return { comments, own, next: uuid(b.next_cursor) };
}

export async function fetchComments(api: ApiClient, contentId: string, beforeId?: string | null) {
    if (!uuid(contentId) || (beforeId && !uuid(beforeId))) throw new ApiError(400, 'invalid_query');
    const q = `content_id=${contentId}${beforeId ? `&before_id=${beforeId}` : ''}`;
    return parseComments(await api.request(`/api/v1/cinema/comments?${q}`));
}

const post = (api: ApiClient, key: string, payload: Record<string, unknown>) =>
    api.request<{ id?: unknown; status?: unknown; idempotent?: unknown }>('/api/v1/cinema/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(payload),
    });

// The same draft keeps its key, so a retry after a network error is one comment, not two.
export async function submitComment(api: ApiClient, contentId: string, body: string, key: string): Promise<{ id: string | null; status: string; replayed: boolean }> {
    if (!uuid(key)) throw new ApiError(400, 'invalid_idempotency_key');
    if (!uuid(contentId) || !bodyOk(body)) throw new ApiError(400, 'invalid_comment');
    const r = await post(api, key, { action: 'submit', content_id: contentId, body: body.trim() });
    return { id: uuid(r?.id), status: typeof r?.status === 'string' ? r.status : 'pending', replayed: r?.idempotent === true };
}

// Withdraws the person's own comment (ADR-0165). Only theirs can be withdrawn; the server checks.
export async function withdrawComment(api: ApiClient, commentId: string, key: string): Promise<{ replayed: boolean }> {
    if (!uuid(key)) throw new ApiError(400, 'invalid_idempotency_key');
    if (!uuid(commentId)) throw new ApiError(400, 'invalid_comment');
    const r = await post(api, key, { action: 'withdraw', comment_id: commentId });
    return { replayed: r?.idempotent === true };
}

export async function reportComment(api: ApiClient, commentId: string, category: string, details: string, key: string): Promise<{ replayed: boolean }> {
    if (!uuid(key)) throw new ApiError(400, 'invalid_idempotency_key');
    if (!uuid(commentId) || !REPORT_CATEGORIES.some((c) => c.key === category) || !detailsOk(details)) throw new ApiError(400, 'invalid_report');
    const r = await post(api, key, { action: 'report', comment_id: commentId, category, details: details.trim() });
    return { replayed: r?.idempotent === true };
}

// Catalog keys for what the person should know, looked up when shown.
export function commentsErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'comments.err.network';
    switch (err.code) {
        case 'profile_required':
            return 'comments.err.profile';
        case 'account_not_active':
            return 'comments.err.account';
        case 'self_report_forbidden':
            return 'comments.err.self';
        case 'comment_not_found':
        case 'content_not_found':
            return 'comments.err.gone';
        case 'pending_limit':
            return 'comments.err.pending';
        case 'rate_limited':
            return 'comments.err.rate';
        case 'idempotency_conflict':
            return 'comments.err.conflict';
        case 'comments_not_open':
            return 'comments.err.notOpen';
        case 'invalid_comment':
        case 'invalid_report':
        case 'invalid_idempotency_key':
        case 'invalid_body':
            return 'comments.err.invalid';
    }
    if (err.status === 429) return 'comments.err.rate';
    if (err.status === 503) return 'comments.err.later';
    return 'common.error';
}
