import { ApiError, type ApiClient } from './api';

// ADR-0125: decisions recorded against the account and the one appeal each allows. Mirrors GET and POST
// /api/v1/appeals (ADR-0083). The operator's reason is never sent by the server and is not shown.
export type SanctionAction = 'warning' | 'takedown' | 'freeze';
export type AppealStatus = 'open' | 'upheld' | 'rejected';

export interface Sanction {
    readonly actionId: string;
    readonly action: SanctionAction | 'other';
    readonly createdAt: string;
    readonly appealStatus: AppealStatus | null;
}

export interface AppealsState {
    readonly sanctions: readonly Sanction[];
    readonly holdUntil: string | null;
    readonly frozen: boolean;
}

export const MIN_STATEMENT = 10;
export const MAX_STATEMENT = 2000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_LABEL: Record<string, string> = { warning: 'Warning', takedown: 'Content removed', freeze: 'Account frozen' };
const STATUS_LABEL: Record<AppealStatus, string> = { open: 'Appeal under review', upheld: 'Appeal successful', rejected: 'Appeal not successful' };

export const actionLabel = (action: string): string => ACTION_LABEL[action] ?? 'Decision';
export const statusLabel = (status: AppealStatus): string => STATUS_LABEL[status];

function parseSanction(raw: unknown): Sanction | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.action_id !== 'string' || !UUID_RE.test(r.action_id) || typeof r.created_at !== 'string') return null;
    const status = r.appeal_status;
    return {
        actionId: r.action_id,
        action: r.action === 'warning' || r.action === 'takedown' || r.action === 'freeze' ? r.action : 'other',
        createdAt: r.created_at,
        appealStatus: status === 'open' || status === 'upheld' || status === 'rejected' ? status : null,
    };
}

export async function fetchAppeals(api: Pick<ApiClient, 'request'>): Promise<AppealsState> {
    const b = await api.request<{ sanctions?: unknown; hold_until?: unknown; frozen?: unknown }>('/api/v1/appeals');
    return {
        sanctions: Array.isArray(b.sanctions) ? b.sanctions.map(parseSanction).filter((s): s is Sanction => s !== null) : [],
        holdUntil: typeof b.hold_until === 'string' ? b.hold_until : null,
        frozen: b.frozen === true,
    };
}

// The same rule the server applies, so a short or long statement is caught before the request.
export function validateStatement(statement: string): string | null {
    const n = statement.trim().length;
    if (n < MIN_STATEMENT) return `Write at least ${MIN_STATEMENT} characters.`;
    if (statement.length > MAX_STATEMENT) return `That is too long (${MAX_STATEMENT} characters at most).`;
    return null;
}

export function canAppeal(s: Sanction): boolean {
    return s.appealStatus === null;
}

export function appealErrorMessage(err: unknown): string {
    if (err instanceof ApiError) {
        if (err.status === 0) return 'No connection. Check your network and try again.';
        if (err.status === 429 || err.code === 'rate_limited') return 'Too many requests. Wait a minute and try again.';
        if (err.code === 'statement_invalid') return `Write ${MIN_STATEMENT} to ${MAX_STATEMENT} characters.`;
        if (err.code === 'action_not_appealable' || err.code === 'action_not_found') return 'This decision cannot be appealed.';
    }
    return 'Your appeal could not be sent. Try again.';
}

// One appeal per decision. A repeat answers with the first appeal (replayed), which is a success.
export async function submitAppeal(api: Pick<ApiClient, 'request'>, actionId: string, statement: string): Promise<{ status: AppealStatus; replayed: boolean }> {
    const invalid = validateStatement(statement);
    if (invalid) throw new Error(invalid);
    if (!UUID_RE.test(actionId)) throw new ApiError(400, 'action_id_invalid');
    const r = await api.request<{ status?: unknown; replayed?: unknown }>('/api/v1/appeals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: actionId, statement: statement.trim() }),
    });
    const status = r.status === 'upheld' || r.status === 'rejected' ? r.status : 'open';
    return { status, replayed: r.replayed === true };
}
