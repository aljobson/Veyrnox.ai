import { ApiError, type ApiClient } from './api';

// Publish drafts (ADR-0139): posts waiting for a person to approve or discard them, usually made in a batch by an
// automation. ADR-0162 adds approve (schedules real posts) and discard (deletes), each behind a confirm that names the
// networks. A draft with no batch cannot be acted on: the route needs a batch id.
// Media job ids are not kept; only the kind of media is shown.

const TEXT_MAX = 600;

export interface Draft {
    readonly id: string;
    readonly batchId: string | null;
    readonly text: string;
    readonly scheduledAt: string | null;
    readonly createdAt: string | null;
    readonly networks: readonly string[];
    readonly mediaTypes: readonly string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function parseDrafts(body: unknown): { drafts: Draft[]; approvalEnabled: boolean } {
    const list = isObject(body) ? body.drafts : null;
    // The server says false when only some networks are released, because approving a batch cannot be filtered by network.
    const approvalEnabled = isObject(body) ? body.approvalEnabled !== false : true;
    if (!Array.isArray(list)) return { drafts: [], approvalEnabled };
    const drafts: Draft[] = [];
    for (const raw of list) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        if (!id) continue;
        drafts.push({
            id,
            batchId: str(raw.draft_batch_id),
            text: (str(raw.global_text) ?? '').slice(0, TEXT_MAX),
            scheduledAt: str(raw.scheduled_at),
            createdAt: str(raw.created_at),
            networks: Array.isArray(raw.networks) ? raw.networks.filter((n): n is string => typeof n === 'string' && n.length > 0) : [],
            mediaTypes: Array.isArray(raw.media) ? raw.media.map((m) => (isObject(m) ? str(m.media_type) : null)).filter((t): t is string => t !== null) : [],
        });
    }
    return { drafts, approvalEnabled };
}

export interface BatchGroup {
    readonly batchId: string | null;
    readonly drafts: readonly Draft[];
}

// By batch, in the order each batch first appears; drafts with no batch are one group of their own.
export function batchGroups(drafts: readonly Draft[]): BatchGroup[] {
    const groups = new Map<string | null, Draft[]>();
    for (const d of drafts) groups.set(d.batchId, [...(groups.get(d.batchId) ?? []), d]);
    return [...groups.entries()].map(([batchId, list]) => ({ batchId, drafts: list }));
}

export const fetchDrafts = async (api: ApiClient) => parseDrafts(await api.request('/api/v1/social/drafts'));

// The networks a group of drafts would post to, each once, in first-seen order.
export const groupNetworks = (drafts: readonly Draft[]): string[] => [...new Set(drafts.flatMap((d) => d.networks))];

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Schedules every draft in the batch. Answers how many were scheduled and how many failed.
export async function approveBatch(api: ApiClient, batchId: string): Promise<{ approved: number; failed: number }> {
    const r = await api.request<{ approved?: unknown; failed?: unknown }>('/api/v1/social/drafts', json({ action: 'approve', batchId }));
    return { approved: typeof r.approved === 'number' ? r.approved : 0, failed: typeof r.failed === 'number' ? r.failed : 0 };
}

// With a post id, discards that one draft; without, every draft left in the batch. Discarding deletes for good.
export async function discardDrafts(api: ApiClient, batchId: string, postId?: string): Promise<number> {
    const r = await api.request<{ discarded?: unknown }>('/api/v1/social/drafts', json({ action: 'discard', batchId, ...(postId ? { postId } : {}) }));
    return typeof r.discarded === 'number' ? r.discarded : 0;
}

export function draftActionErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'drafts.err.network';
    if (err.status === 402) return 'drafts.err.plan';
    if (err.status === 403) return 'drafts.err.role';
    if (err.status === 429) return 'drafts.err.rate';
    if (err.status === 400 || err.status === 404) return 'drafts.err.gone';
    if (err.code === 'draft_approval_not_available') return 'drafts.err.notAvailable';
    return 'drafts.err.later';
}

// Catalog keys for what the person should know, looked up when shown.
export function draftsErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'drafts.err.network';
    if (err.status === 429) return 'drafts.err.rate';
    if (err.status === 404) return 'drafts.err.brand';
    if (err.status === 503) return 'drafts.err.later';
    return 'common.error';
}
