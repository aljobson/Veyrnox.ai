import { ApiError, type ApiClient } from './api';
import type { PlanSource, PublishTier } from './publishPlan';

// Read, then edit like the web: the web saves a whole workflow with PUT (there is no PATCH toggle), so switching one on or off
// sends the workflow's current fields with `enabled` flipped. Delete is DELETE ?id=.
const object = (v: unknown): Record<string, unknown> | null =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const number = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const boolean = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null;
const date = (v: unknown): string | null =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
const bounded = (v: unknown, max: number): string => {
    // eslint-disable-next-line no-control-regex
    const s = typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : '';
    return s.length > max ? `${s.slice(0, max)}…` : s;
};

export interface Workflow {
    readonly id: string;
    readonly name: string;
    readonly kind: 'message' | 'comment' | 'review' | 'any' | 'unknown';
    readonly matchMode: 'contains' | 'exact' | 'unknown';
    readonly keyword: string;
    readonly enabled: boolean | null;
    readonly suggestionCount: number | null;
    readonly updatedAt: string | null;
    readonly replyText: string;
    readonly accountId: string | null;
    readonly allAccounts: boolean;
    readonly accountName: string;
    readonly network: string;
}

export function parseWorkflows(body: unknown): Workflow[] {
    const rows = object(body)?.workflows;
    if (!Array.isArray(rows)) throw new ApiError(503, 'workflows_unavailable');
    return rows.flatMap((raw): Workflow[] => {
        const r = object(raw);
        if (!r || typeof r.id !== 'string' || !UUID.test(r.id)) return [];
        return [{
            id: r.id, name: bounded(r.name, 80),
            kind: r.kind === null ? 'any' : r.kind === 'message' || r.kind === 'comment' || r.kind === 'review' ? r.kind : 'unknown',
            matchMode: r.match_mode === 'contains' || r.match_mode === 'exact' ? r.match_mode : 'unknown',
            keyword: bounded(r.keyword, 100), enabled: boolean(r.enabled),
            suggestionCount: number(r.suggestion_count), updatedAt: date(r.updated_at),
            replyText: bounded(r.reply_text, 8000), accountId: typeof r.account_id === 'string' && UUID.test(r.account_id) ? r.account_id : null, allAccounts: r.account_id === null,
            accountName: bounded(r.account_name, 80), network: bounded(r.network, 40),
        }];
    });
}

export const fetchWorkflows = async (api: ApiClient): Promise<Workflow[]> =>
    parseWorkflows(await api.request('/api/v1/social/workflows'));

export interface WorkflowDraft {
    readonly id: string | null;
    readonly accountId: string | null;
    readonly name: string;
    readonly kind: 'message' | 'comment' | 'review' | null;
    readonly matchMode: 'contains' | 'exact';
    readonly keyword: string;
    readonly replyText: string;
    readonly enabled: boolean;
}

// The same limits the route enforces: name 1-80, keyword 1-100, reply 1-8000 after trimming.
export function cleanWorkflowDraft(d: WorkflowDraft): WorkflowDraft | null {
    const name = d.name.trim();
    const keyword = d.keyword.trim();
    const replyText = d.replyText.trim();
    if (!name || name.length > 80 || !keyword || keyword.length > 100 || !replyText || replyText.length > 8000) return null;
    return { ...d, name, keyword, replyText };
}

export const draftOf = (w: Workflow): WorkflowDraft => ({
    id: w.id, accountId: w.accountId, name: w.name,
    kind: w.kind === 'message' || w.kind === 'comment' || w.kind === 'review' ? w.kind : null,
    matchMode: w.matchMode === 'exact' ? 'exact' : 'contains', keyword: w.keyword, replyText: w.replyText, enabled: w.enabled === true,
});

export const saveWorkflow = (api: ApiClient, d: WorkflowDraft) =>
    api.request('/api/v1/social/workflows', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
export const deleteWorkflow = (api: ApiClient, id: string) =>
    api.request(`/api/v1/social/workflows?id=${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface WorkflowPlan {
    readonly tier: PublishTier;
    readonly accountLimit: number | null;
    readonly analyticsDays: number | null;
    readonly bestTimeEnabled: boolean | null;
    readonly source: PlanSource | null;
    readonly periodEnd: string | null;
    readonly cancelAtPeriodEnd: boolean | null;
    readonly status: 'active' | 'past_due' | null;
}

// Read only the entitlement. Catalogue names, prices and payment URLs never reach the new surface.
export function parseWorkflowPlan(body: unknown): WorkflowPlan | null {
    const e = object(object(body)?.entitlement);
    if (!e || (e.tier !== 'free' && e.tier !== 'publish')) return null;
    const sub = object(e.subscription);
    return {
        tier: e.tier, accountLimit: number(e.account_limit), analyticsDays: number(e.analytics_days),
        bestTimeEnabled: boolean(e.best_time_enabled),
        source: sub?.source === 'stripe' || sub?.source === 'store' ? sub.source : null,
        periodEnd: date(sub?.current_period_end), cancelAtPeriodEnd: boolean(sub?.cancel_at_period_end),
        status: sub?.status === 'active' || sub?.status === 'past_due' ? sub.status : null,
    };
}

export const fetchWorkflowPlan = async (api: ApiClient): Promise<WorkflowPlan | null> =>
    parseWorkflowPlan(await api.request('/api/v1/social/plan'));

export const planManagementKey = (source: PlanSource | null): string | null =>
    source === 'stripe' ? 'publishWorkflows.manageWeb' : source === 'store' ? 'publishWorkflows.manageStore' : null;

export const planPeriodKey = (plan: WorkflowPlan): string =>
    plan.cancelAtPeriodEnd === true ? 'publishWorkflows.ends'
        : plan.status === 'active' && plan.cancelAtPeriodEnd === false ? 'publishWorkflows.renews'
            : 'publishWorkflows.periodEnd';

export function workflowErrorKey(error: unknown): string {
    if (error instanceof ApiError) {
        if ([402, 403, 404, 503].includes(error.status)) return 'publishWorkflows.unavailable';
        if (error.status === 0) return 'publishWorkflows.network';
    }
    return 'publishWorkflows.failed';
}
