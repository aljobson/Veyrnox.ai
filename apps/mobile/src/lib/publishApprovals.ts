import { ApiError, type ApiClient } from './api';

// Approvals, read-only (ADR-0135). A person who publishes can ask outside reviewers to approve a post; each reviewer
// gets a signed link and decides on the web. The app only shows where each request stands. The server adds that
// signed link to every reviewer in this list: it is a bearer link, so it is dropped here on purpose and never shown,
// stored or shared from the app.

const TEXT_MAX = 600;

export interface ApprovalReviewer {
    readonly id: string;
    readonly email: string;
    readonly decision: string;
    readonly comment: string | null;
    readonly decidedAt: string | null;
}

export interface ApprovalRequest {
    readonly id: string;
    readonly postId: string | null;
    readonly status: string;
    readonly policy: string | null;
    readonly text: string;
    readonly scheduledAt: string | null;
    readonly createdAt: string | null;
    readonly reviewers: readonly ApprovalReviewer[];
}

const rec = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const bounded = (v: unknown): string | null => {
    const s = str(v);
    return s === null ? null : s.slice(0, TEXT_MAX);
};

function parseReviewer(raw: unknown): ApprovalReviewer | null {
    const r = rec(raw);
    const id = str(r?.id);
    const email = str(r?.email);
    if (!r || !id || !email) return null;
    // `url` is deliberately not read.
    return { id, email: email.slice(0, 120), decision: str(r.decision) ?? 'pending', comment: bounded(r.comment), decidedAt: str(r.decided_at) };
}

export function parseApprovals(body: unknown): ApprovalRequest[] {
    const list = rec(body)?.requests;
    if (!Array.isArray(list)) return [];
    const out: ApprovalRequest[] = [];
    for (const raw of list) {
        const r = rec(raw);
        const id = str(r?.id);
        if (!r || !id) continue;
        const reviewers = Array.isArray(r.reviewers) ? r.reviewers.map(parseReviewer).filter((v): v is ApprovalReviewer => v !== null) : [];
        out.push({
            id,
            postId: str(r.post_id),
            status: str(r.status) ?? 'pending',
            policy: str(r.policy),
            text: bounded(r.global_text) ?? '',
            scheduledAt: str(r.scheduled_at),
            createdAt: str(r.created_at),
            reviewers,
        });
    }
    return out;
}

const tidy = (s: string): string => {
    const t = s.replace(/_/g, ' ').trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};

const STATUS: Record<string, string> = { pending: 'Waiting for review', approved: 'Approved', rejected: 'Rejected', commented: 'Has comments', canceled: 'Canceled', failed: 'Could not be sent' };
const DECISION: Record<string, string> = { pending: 'Not yet', approved: 'Approved', rejected: 'Rejected', commented: 'Left a comment' };

export const approvalStatusLabel = (s: string): string => STATUS[s] ?? (tidy(s) || 'Waiting for review');
export const decisionLabel = (s: string): string => DECISION[s] ?? (tidy(s) || 'Not yet');

// The brand header is added by withBrand, so this is a plain read.
export async function fetchApprovals(api: ApiClient): Promise<ApprovalRequest[]> {
    return parseApprovals(await api.request('/api/v1/social/approvals'));
}

// Catalog keys for what the person should know, looked up when shown.
export function approvalErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'approvals.err.network';
    if (err.status === 429) return 'approvals.err.rate';
    if (err.status === 402) return 'approvals.err.plan';
    if (err.status === 403) return 'approvals.err.role';
    if (err.status === 404) return err.code === 'approvals_not_open' ? 'approvals.err.notOpen' : 'approvals.err.brand';
    if (err.status === 503) return 'approvals.err.later';
    return 'common.error';
}
