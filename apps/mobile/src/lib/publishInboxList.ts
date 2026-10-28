import { ApiError, type ApiClient } from './api';
import { KINDS, STATES, parseThread, type InboxKind, type InboxState, type Member, type Thread } from './publishInbox';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG = /^[a-z0-9][a-z0-9 _-]*$/;
export const PRIORITIES = ['normal', 'high', 'urgent'] as const;
export type Priority = typeof PRIORITIES[number];
export interface InboxFilter {
    state: InboxState; kind: InboxKind | null; accountId: string | null;
    assignee: string | null; priority: Priority | null; tag: string | null; search: string;
}
export const defaultInboxFilter = (): InboxFilter => ({ state: 'unresolved', kind: null, accountId: null, assignee: null, priority: null, tag: null, search: '' });
export function inboxQuery(f: InboxFilter): string {
    const pairs: [string, string][] = [];
    if (STATES.includes(f.state)) pairs.push(['state', f.state]);
    if (f.kind && KINDS.includes(f.kind)) pairs.push(['kind', f.kind]);
    if (f.accountId && UUID.test(f.accountId)) pairs.push(['accountId', f.accountId]);
    if (f.assignee && (f.assignee === 'unassigned' || UUID.test(f.assignee))) pairs.push(['assignee', f.assignee]);
    if (f.priority && PRIORITIES.includes(f.priority)) pairs.push(['priority', f.priority]);
    const tag = f.tag?.trim().toLowerCase();
    if (tag && tag.length <= 32 && TAG.test(tag)) pairs.push(['tag', tag]);
    const search = f.search?.trim();
    if (search && search.length <= 100) pairs.push(['search', search]);
    return pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const bounded = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : '';
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
export type ListingThread = Thread & { preview: string };
export function parseInboxListing(body: unknown) {
    const b = object(body), c = object(b.counts);
    const threads: ListingThread[] = (Array.isArray(b.threads) ? b.threads : []).flatMap(raw => {
        const thread = parseThread(raw);
        return thread ? [{ ...thread, preview: bounded(object(raw).preview, 200), assignedEmail: bounded(thread.assignedEmail, 80) || null, tags: thread.tags.map(tag => bounded(tag, 32)) }] : [];
    });
    const members: Member[] = (Array.isArray(b.members) ? b.members : []).flatMap(raw => {
        const m = object(raw), email = bounded(m.email, 80);
        return typeof m.user_id === 'string' && UUID.test(m.user_id) && email.trim() ? [{ userId: m.user_id, email }] : [];
    });
    const tags = (Array.isArray(b.tags) ? b.tags : []).filter((tag): tag is string => typeof tag === 'string' && tag.length <= 32 && TAG.test(tag)).slice(0, 50);
    return { threads, members, tags, counts: { all: number(c.all), unread: number(c.unread), unresolved: number(c.unresolved), resolved: number(c.resolved) } };
}
export const fetchInboxListing = async (api: ApiClient, filter: InboxFilter) => parseInboxListing(await api.request(`/api/v1/social/inbox?${inboxQuery(filter)}`));
async function patch(api: ApiClient, id: string, body: object) {
    if (!UUID.test(id)) throw new ApiError(400, 'invalid_thread_id');
    return api.request(`/api/v1/social/inbox/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
export const markThreadRead = (api: ApiClient, id: string) => patch(api, id, { action: 'read' });
export const setThreadPriority = (api: ApiClient, id: string, priority: Priority) => patch(api, id, { action: 'priority', priority });
export const setThreadTags = (api: ApiClient, id: string, tags: string[]) => patch(api, id, { action: 'tags', tags });
export function parseThreadTags(text: string): { tags: string[]; error?: never } | { error: string; tags?: never } {
    const tags: string[] = [], seen = new Set<string>();
    for (const part of text.split(',')) {
        const tag = part.trim();
        if (!tag) continue;
        if (tag.length > 32) return { error: 'publishOps.inbox.tagTooLong' };
        if (!seen.has(tag.toLowerCase())) { seen.add(tag.toLowerCase()); tags.push(tag); }
    }
    return tags.length > 10 ? { error: 'contacts.err.tooManyTags' } : { tags };
}
