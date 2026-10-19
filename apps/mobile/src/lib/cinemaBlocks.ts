import { ApiError, type ApiClient } from './api';

// Blocking another Cinema member (ADR-0141), over the server's ADR-0135. A person blocks by the member's public
// username; the server then leaves that member's comments and titles out of what this person is shown. A block is
// private to the person who made it and is undone from the Blocked members list. Reporting stays separate: a block
// hides content from one person, a report asks the operator to act for everyone.

const USERNAME_RE = /^[a-z][a-z0-9_]{2,29}$/;
const NAME_MAX = 60;

export const isUsername = (v: unknown): v is string => typeof v === 'string' && USERNAME_RE.test(v);

export interface BlockedMember {
    readonly username: string;
    readonly displayName: string;
    readonly createdAt: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseBlocks(body: unknown): BlockedMember[] {
    const list = isObject(body) ? body.blocks : null;
    if (!Array.isArray(list)) return [];
    const out: BlockedMember[] = [];
    for (const raw of list) {
        if (!isObject(raw) || !isUsername(raw.username)) continue;
        const name = typeof raw.display_name === 'string' && raw.display_name.trim() ? raw.display_name.trim().slice(0, NAME_MAX) : raw.username;
        out.push({ username: raw.username, displayName: name, createdAt: typeof raw.created_at === 'string' ? raw.created_at : null });
    }
    return out;
}

export const fetchBlocks = async (api: ApiClient) => parseBlocks(await api.request('/api/v1/cinema/blocks'));

const already = (res: unknown): { already: boolean } => ({ already: isObject(res) && res.already === true });

// The same member blocked twice changes nothing and answers already: true, so there is no idempotency key to keep.
export async function blockMember(api: ApiClient, username: string): Promise<{ already: boolean }> {
    if (!isUsername(username)) throw new ApiError(400, 'invalid_username');
    return already(await api.request('/api/v1/cinema/blocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) }));
}

export async function unblockMember(api: ApiClient, username: string): Promise<{ already: boolean }> {
    if (!isUsername(username)) throw new ApiError(400, 'invalid_username');
    return already(await api.request(`/api/v1/cinema/blocks/${encodeURIComponent(username)}`, { method: 'DELETE' }));
}

// Catalog keys for what the person should know, looked up when shown.
export function blocksErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'blocks.err.network';
    if (err.status === 429) return 'blocks.err.rate';
    if (err.code === 'cannot_block_self') return 'blocks.err.self';
    if (err.code === 'user_not_found') return 'blocks.err.notFound';
    if (err.code === 'block_limit') return 'blocks.err.limit';
    if (err.code === 'account_not_found') return 'blocks.err.account';
    if (err.code === 'viewing_not_open') return 'blocks.err.notOpen';
    if (err.status === 503) return 'blocks.err.later';
    return 'common.error';
}
