import { ApiError, type ApiClient } from './api';

// ADR-0180: the Publish inbox, read-only. Conversations from the connected accounts: messages, comments and reviews.
// What people wrote is third-party text, so it is shown as plain bounded text; links the network sent are never opened
// from here. Replies, assigning, tagging and resolving stay on the web for now (read first).

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BODY_MAX = 2000;
const NAME_MAX = 80;

export const STATES = ['unresolved', 'unread', 'resolved', 'all'] as const;
export type InboxState = (typeof STATES)[number];
export const KINDS = ['message', 'comment', 'review'] as const;
export type InboxKind = (typeof KINDS)[number];

const bounded = (v: unknown, max: number): string => {
    // eslint-disable-next-line no-control-regex
    const s = typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : '';
    return s.length > max ? `${s.slice(0, max)}…` : s;
};

export interface Thread {
    readonly id: string;
    readonly network: string;
    readonly accountName: string;
    readonly kind: string;
    readonly name: string;
    readonly subject: string;
    readonly status: string;
    readonly unread: number;
    readonly latestAt: string | null;
    readonly priority: string;
    readonly assignedEmail: string | null;
    readonly tags: string[];
}
export interface Counts {
    readonly all: number;
    readonly unread: number;
    readonly unresolved: number;
}

export function parseThread(raw: unknown): Thread | null {
    if (!isObject(raw)) return null;
    const id = str(raw.id);
    if (!id || !UUID_RE.test(id)) return null;
    return {
        id,
        network: str(raw.network) ?? '',
        accountName: bounded(raw.account_name, NAME_MAX),
        kind: str(raw.kind) ?? 'message',
        name: bounded(raw.participant_name, NAME_MAX),
        subject: bounded(raw.subject, 200),
        status: str(raw.status) ?? 'open',
        unread: num(raw.unread_count),
        latestAt: str(raw.latest_message_at),
        priority: str(raw.priority) ?? 'normal',
        assignedEmail: str(raw.assigned_email),
        tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string').slice(0, 10) : [],
    };
}

export function parseInbox(body: unknown): { threads: Thread[]; counts: Counts } {
    const b = isObject(body) ? body : {};
    const threads = (Array.isArray(b.threads) ? b.threads : []).map(parseThread).filter((t): t is Thread => t !== null);
    const c = isObject(b.counts) ? b.counts : {};
    return { threads, counts: { all: num(c.all), unread: num(c.unread), unresolved: num(c.unresolved) } };
}

export async function fetchInbox(api: ApiClient, state: InboxState, kind: InboxKind | null) {
    const q = [`state=${encodeURIComponent(state)}`];
    if (kind) q.push(`kind=${encodeURIComponent(kind)}`);
    return parseInbox(await api.request(`/api/v1/social/inbox?${q.join('&')}`));
}

export interface Message {
    readonly id: string;
    readonly outgoing: boolean;
    readonly body: string;
    readonly hasMedia: boolean;
    readonly deliveryStatus: string | null;
    readonly sentAt: string | null;
}
export interface Note {
    readonly id: string;
    readonly body: string;
    readonly author: string;
    readonly createdAt: string | null;
}

export function parseThreadView(body: unknown): { thread: Thread | null; canReply: boolean; messages: Message[]; notes: Note[] } {
    const b = isObject(body) ? body : {};
    const thread = parseThread(b.thread);
    const messages: Message[] = [];
    for (const raw of Array.isArray(b.messages) ? b.messages : []) {
        if (!isObject(raw) || !str(raw.id)) continue;
        messages.push({
            id: raw.id as string,
            outgoing: raw.direction === 'outbound' || raw.direction === 'out',
            body: bounded(raw.body, BODY_MAX),
            hasMedia: Array.isArray(raw.media) && raw.media.length > 0,
            deliveryStatus: str(raw.delivery_status),
            sentAt: str(raw.sent_at),
        });
    }
    const notes: Note[] = [];
    for (const raw of Array.isArray(b.notes) ? b.notes : []) {
        if (isObject(raw) && str(raw.id)) notes.push({ id: raw.id as string, body: bounded(raw.body, BODY_MAX), author: bounded(raw.actor_email, NAME_MAX) || 'Someone', createdAt: str(raw.created_at) });
    }
    return { thread, canReply: isObject(b.thread) && b.thread.can_reply === true, messages, notes };
}

export async function fetchThread(api: ApiClient, id: string) {
    if (!UUID_RE.test(id)) throw new ApiError(400, 'invalid_thread_id');
    return parseThreadView(await api.request(`/api/v1/social/inbox/${encodeURIComponent(id)}`));
}

export function inboxErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'inbox.err.network';
    if (err.status === 402) return 'inbox.err.plan';
    if (err.status === 403) return 'inbox.err.role';
    if (err.status === 503) return 'inbox.err.notOpen';
    if (err.status === 404) return 'inbox.err.gone';
    if (err.status === 429) return 'inbox.err.rate';
    return 'inbox.err.later';
}
