import { ApiError, type ApiClient } from './api';

// Publish drafts, read-only (ADR-0139): posts waiting for a person to approve or discard them, usually made in a batch
// by an automation. The app lists them so a person knows something is waiting. Approving (which schedules real posts)
// and discarding (which deletes) are not here: they stay on veyrnox.ai until the owner decides they belong on a phone.
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

export function parseDrafts(body: unknown): { drafts: Draft[] } {
    const list = isObject(body) ? body.drafts : null;
    if (!Array.isArray(list)) return { drafts: [] };
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
    return { drafts };
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

// Catalog keys for what the person should know, looked up when shown.
export function draftsErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'drafts.err.network';
    if (err.status === 429) return 'drafts.err.rate';
    if (err.status === 404) return 'drafts.err.brand';
    if (err.status === 503) return 'drafts.err.later';
    return 'common.error';
}
