import { ApiError, type ApiClient } from './api';
import { contactsErrorKey, parseTags, STATUSES, TAG_RE, validateEdit, type Subscription } from './publishContacts';

export interface ImportContact { externalId: string; name: string; tags: string[]; subscriptionStatus: Subscription; notes: string }
export interface ManualFields { externalId: string; name: string; tags: string; subscriptionStatus: Subscription; notes: string }
export function manualContact(fields: ManualFields): { contact: ImportContact; error?: never } | { error: string; contact?: never } {
    const externalId = fields.externalId.trim(), name = fields.name.trim();
    if (!externalId || externalId.length > 256 || !name || name.length > 120 || !STATUSES.includes(fields.subscriptionStatus)) return { error: 'contacts.err.invalid' };
    const error = validateEdit(fields.tags, fields.notes);
    if (error) return { error };
    return { contact: { externalId, name, tags: parseTags(fields.tags).tags, subscriptionStatus: fields.subscriptionStatus, notes: fields.notes.trim() } };
}
// Port of lib/social/contactCsv.js. Keep header, row and validation behavior in step with the web.
const REQUIRED = ['external_id', 'name'];
const ALLOWED = new Set(['external_id', 'name', 'tags', 'subscription_status', 'notes']);
export function parseContactCsv(text: string): { contacts: ImportContact[]; error?: never; row?: never } | { error: string; row?: number; contacts?: never } {
    if (typeof text !== 'string' || !text.trim()) return { error: 'publishOps.csv.empty' };
    const result: string[][] = []; let row: string[] = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (char === '"') quoted = false;
            else field += char;
        } else if (char === '"' && field.length === 0) quoted = true;
        else if (char === ',') { row.push(field); field = ''; }
        else if (char === '\n') { row.push(field); result.push(row); row = []; field = ''; }
        else if (char !== '\r') field += char;
    }
    if (quoted) return { error: 'publishOps.csv.quote' };
    if (field || row.length) { row.push(field); result.push(row); }
    const parsed = result.filter(item => item.some(value => value.trim()));
    if (parsed.length < 2) return { error: 'publishOps.csv.headers' };
    const headers = parsed[0].map(value => value.trim().toLowerCase());
    if (headers.some(value => !ALLOWED.has(value)) || new Set(headers).size !== headers.length || REQUIRED.some(value => !headers.includes(value))) return { error: 'publishOps.csv.headers' };
    const contacts: ImportContact[] = [];
    for (const [index, values] of parsed.slice(1).entries()) {
        if (values.length > headers.length) return { error: 'publishOps.csv.columns', row: index + 2 };
        const item = Object.fromEntries(headers.map((header, column) => [header, (values[column] || '').trim()]));
        const tags = [...new Set((item.tags || '').split('|').map(value => value.trim().toLowerCase()).filter(Boolean))];
        const status = (item.subscription_status || 'unknown').toLowerCase() as Subscription;
        if (!item.external_id || item.external_id.length > 256 || !item.name || item.name.length > 120 || tags.length > 10 || tags.some(tag => tag.length > 32 || !TAG_RE.test(tag)) || !STATUSES.includes(status) || (item.notes || '').length > 2000) return { error: 'publishOps.csv.row', row: index + 2 };
        contacts.push({ externalId: item.external_id, name: item.name, tags, subscriptionStatus: status, notes: item.notes || '' });
    }
    if (contacts.length > 250) return { error: 'publishOps.csv.tooMany' };
    if (new Set(contacts.map(item => item.externalId)).size !== contacts.length) return { error: 'publishOps.csv.duplicate' };
    return { contacts };
}
export async function importContacts(api: ApiClient, accountId: string, source: 'manual' | 'csv', contacts: ImportContact[]): Promise<number> {
    const body = { accountId, source, contacts: contacts.map(({ externalId, name, tags, subscriptionStatus, notes }) => ({ externalId, name, tags, subscriptionStatus, notes })) };
    const result = await api.request<{ imported: number }>('/api/v1/social/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return result.imported;
}
export const importErrorKey = (err: unknown): string => err instanceof ApiError && err.status === 404 ? 'publishOps.import.accountGone' : err instanceof ApiError && err.status === 400 ? 'contacts.err.invalid' : contactsErrorKey(err);
