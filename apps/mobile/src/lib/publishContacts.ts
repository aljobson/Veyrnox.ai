import { ApiError, type ApiClient } from './api';

// ADR-0165: contacts, from the Publish inbox's conversations. A person's tags, subscription status and notes can be
// changed; adding contacts and CSV import stay on the web. The routes answer 503 `publish_inbox_not_open` while the
// inbox flag or the plans are off, and 402 without the Publish Plan.

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const NOTES_MAX = 2000;

export const STATUSES = ['unknown', 'subscribed', 'unsubscribed'] as const;
export type Subscription = (typeof STATUSES)[number];
export const TAG_RE = /^[a-z0-9][a-z0-9 _-]*$/;
export const MAX_TAGS = 10;

export interface Contact {
    readonly accountId: string;
    readonly network: string;
    readonly accountName: string;
    readonly externalId: string;
    readonly name: string;
    readonly lastActiveAt: string | null;
    readonly messages: number;
    readonly unread: number;
    readonly tags: string[];
    readonly status: Subscription;
    readonly notes: string;
}

export function parseContacts(body: unknown): { contacts: Contact[]; canEdit: boolean } {
    const b = isObject(body) ? body : {};
    const contacts: Contact[] = [];
    for (const raw of Array.isArray(b.contacts) ? b.contacts : []) {
        if (!isObject(raw)) continue;
        const accountId = str(raw.account_id);
        const externalId = str(raw.external_id);
        if (!accountId || !externalId) continue;
        const status = STATUSES.find((s) => s === raw.subscription_status) ?? 'unknown';
        contacts.push({
            accountId, externalId, status,
            network: str(raw.network) ?? '',
            accountName: str(raw.account_name) ?? '',
            name: str(raw.name) ?? externalId.slice(0, 40),
            lastActiveAt: str(raw.last_active_at),
            messages: num(raw.message_count),
            unread: num(raw.unread_count),
            tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
            notes: typeof raw.notes === 'string' ? raw.notes.slice(0, NOTES_MAX) : '',
        });
    }
    // Tags and status can be changed by owner, manager, editor and reviewer.
    const canEdit = ['owner', 'manager', 'editor', 'reviewer'].includes(String(b.brandRole));
    return { contacts, canEdit };
}

export interface ContactFilter {
    readonly search?: string;
    readonly status?: Subscription | null;
}

export async function fetchContacts(api: ApiClient, f: ContactFilter = {}) {
    const q: string[] = [];
    if (f.search?.trim()) q.push(`search=${encodeURIComponent(f.search.trim().slice(0, 100))}`);
    if (f.status) q.push(`subscriptionStatus=${encodeURIComponent(f.status)}`);
    return parseContacts(await api.request(`/api/v1/social/contacts${q.length ? `?${q.join('&')}` : ''}`));
}

// "VIP, Press" -> ["vip","press"]; entries that are not valid tags are dropped and reported.
export function parseTags(text: string): { tags: string[]; rejected: string[] } {
    const tags: string[] = [];
    const rejected: string[] = [];
    for (const part of text.split(',')) {
        const t = part.trim().toLowerCase();
        if (!t) continue;
        if (t.length > 32 || !TAG_RE.test(t)) rejected.push(part.trim());
        else if (!tags.includes(t)) tags.push(t);
    }
    return { tags, rejected };
}

// A key into the catalog for what is wrong, or null.
export function validateEdit(tagsText: string, notes: string): string | null {
    const { tags, rejected } = parseTags(tagsText);
    if (rejected.length > 0) return 'contacts.err.tag';
    if (tags.length > MAX_TAGS) return 'contacts.err.tooManyTags';
    if (notes.trim().length > NOTES_MAX) return 'contacts.err.notes';
    return null;
}

export const saveContact = (api: ApiClient, c: Contact, tags: string[], status: Subscription, notes: string) =>
    api.request('/api/v1/social/contacts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: c.accountId, externalId: c.externalId, tags, subscriptionStatus: status, notes: notes.trim() }) });

export function contactsErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'contacts.err.network';
    if (err.status === 402) return 'contacts.err.plan';
    if (err.status === 403) return 'contacts.err.role';
    if (err.status === 503 || err.code === 'publish_inbox_not_open') return 'contacts.err.notOpen';
    if (err.status === 404) return 'contacts.err.gone';
    if (err.status === 429) return 'contacts.err.rate';
    if (err.status === 400) return 'contacts.err.invalid';
    return 'contacts.err.later';
}
