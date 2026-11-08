import { ApiError, type ApiClient } from './api';
import { sendKeyFor, type PendingSend } from './chat';
import { requireOnline, OfflineError, OFFLINE_PAID_MESSAGE } from './network';
import { t } from './i18n';
import type { Timeline } from './nativeEditorModel';
import type { Command } from './editorAgentPlan';
export const AI_EDIT_PATH = '/api/v1/editor/ai-edit';
export type AiEditQuote = { credits: number; max_commands: number; max_instruction_chars: number };
export type AiEditOutcome = { status: 'pending' | 'completed' | 'failed'; credits: number; refunded?: boolean; plan?: { commands: Command[] }; skipped?: { index: number; reason: string }[]; summary?: string };
export function aiEditKeyFor(previous: PendingSend | null, instruction: string, timeline: Timeline, make: () => string): PendingSend {
    const signature = JSON.stringify(timeline, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
    return sendKeyFor(previous, instruction.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(), { thinking: false, web: false }, make, signature);
}
export async function fetchAiEditQuote(api: ApiClient): Promise<AiEditQuote | null> {
    try {
        const quote = await api.request<AiEditQuote>(`${AI_EDIT_PATH}/quote`);
        if (!Number.isSafeInteger(quote.credits) || quote.credits < 1) throw new ApiError(200, 'bad_response');
        return quote;
    } catch (error) { if (error instanceof ApiError && error.status === 501) return null; throw error; }
}
export async function recoverAiEdit(api: ApiClient, key: string, accountId: string): Promise<AiEditOutcome> {
    // Read-only: keep auth ownership, but never pass through a paid-action check.
    return api.request<AiEditOutcome>(`${AI_EDIT_PATH}/by-key/${encodeURIComponent(key)}`, {}, { owner: accountId });
}
export const ambiguousAiEditError = (error: unknown) => !(error instanceof ApiError) || error.status === 0 || error.code === 'bad_response' ||
    (error.status >= 500 && !['editor_ai_edit_unavailable', 'rate_check_unavailable', 'read_unavailable', 'debit_rejected', 'request_unavailable'].includes(error.code));
export async function runAiEdit(api: ApiClient, { instruction, timeline, key, expectedCredits, accountId }: {
    instruction: string; timeline: Timeline; key: string; expectedCredits: number; accountId: string;
}): Promise<AiEditOutcome> {
    requireOnline();
    try {
        const result = await api.request<AiEditOutcome>(AI_EDIT_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instruction, timeline, idempotencyKey: key, expectedCredits }) }, { timeoutMs: 60_000, owner: accountId });
        if (!['pending', 'completed', 'failed'].includes(result?.status)) throw new ApiError(200, 'bad_response');
        return result;
    } catch (error) {
        if (error instanceof ApiError && error.body.refunded === true) throw error;
        if (!ambiguousAiEditError(error)) throw error;
        try { return await recoverAiEdit(api, key, accountId); }
        catch { throw new ApiError(503, 'outcome_pending'); }
    }
}
export function aiEditMessage(error: unknown): string {
    if (error instanceof OfflineError) return OFFLINE_PAID_MESSAGE;
    if (!(error instanceof ApiError)) return t('editorAi.failed');
    if (error.code === 'account_frozen') return t('accountDeletion.youraccountisfrozenContactsupportto');
    if (error.code === 'account_on_hold') return t('accountDeletion.youraccountisonholdContactsupport');
    const messages: Record<string, string> = { plan_unusable: 'editorAi.unusable', invalid_timeline: 'editorAi.unusable', invalid_instruction: 'editorAi.instructionRequired',
        editor_ai_edit_unavailable: 'editorAi.unavailable', price_changed: 'editorAi.priceChanged', outcome_pending: 'editorAi.pending', refund_pending: 'editorAi.pending',
        request_failed_refunded: 'editorAi.failed', provider_unavailable: 'editorAi.failed', timeout: 'editorAi.failed', result_expired: 'editorAi.expired',
        idempotency_conflict: 'editorAi.conflict', insufficient_balance: 'editorAi.balance', subscription_required: 'editorAi.subscription', consent_declined: 'editorAi.consent', rate_limited: 'editorAi.rateLimited' };
    return t(messages[error.code] || 'editorAi.failed');
}
