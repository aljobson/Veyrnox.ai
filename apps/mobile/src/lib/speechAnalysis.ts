import { ApiError, type ApiClient } from './api';
import { getCacheUser, subscribeCacheUser } from './appCache';
import { sendKeyFor, type PendingSend } from './chat';
import { requireOnline, OfflineError, OFFLINE_PAID_MESSAGE } from './network';
import { t } from './i18n';
import { parseSmartCutAnalysis, type SpeechAnalysis } from './speechCut';
export const SPEECH_PATH = '/api/v1/editor/speech-analyses';
export type SpeechQuote = { credits: number; max_seconds: 60; languages: string[] };
export type SpeechOutcome = { id: string; status: 'queued' | 'completed' | 'failed'; progress?: 'queued' | 'transcribing'; analysis?: SpeechAnalysis; refunded?: boolean };
// Memory only. appCache's identity subscription invalidates results, keys and active requests together.
const results = new Map<string, SpeechOutcome>(), keys = new Map<string, PendingSend>(), active = new Set<AbortController>();
subscribeCacheUser(() => { results.clear(); keys.clear(); for (const controller of active) controller.abort(); active.clear(); });
const scope = (account: string, job: string) => `${account}:${job}`;
export function speechKeyFor(account: string, source: string, duration: number, make: () => string): string {
    const id = scope(account, source), previous = keys.get(id) || null;
    const pending = sendKeyFor(previous, source, { thinking: false, web: false }, make, String(duration));
    keys.set(id, pending); return pending.key;
}
export function forgetSpeechKey(account: string, source: string) { keys.delete(scope(account, source)); }
export async function fetchSpeechQuote(api: ApiClient, signal?: AbortSignal): Promise<SpeechQuote | null> {
    try {
        const result = await api.request<SpeechQuote>(`${SPEECH_PATH}/quote`, { signal });
        if (!Number.isSafeInteger(result.credits) || result.credits < 1 || result.max_seconds !== 60 || !Array.isArray(result.languages)) throw new ApiError(200, 'bad_response');
        return result;
    } catch (error) { if (error instanceof ApiError && error.status === 501) return null; throw error; }
}
function outcome(value: SpeechOutcome): SpeechOutcome {
    if (!value || !['queued', 'completed', 'failed'].includes(value.status)) throw new ApiError(200, 'bad_response');
    if (value.status === 'completed') {
        const parsed = parseSmartCutAnalysis(value.analysis); if (!parsed.ok) throw new ApiError(200, 'bad_response');
        return { ...value, analysis: parsed.analysis };
    }
    return value;
}
export async function recoverSpeech(api: ApiClient, key: string, account: string, signal?: AbortSignal) {
    return outcome(await api.request<SpeechOutcome>(`${SPEECH_PATH}/by-key/${encodeURIComponent(key)}`, { signal }, { owner: account }));
}
export async function startSpeech(api: ApiClient, input: { account: string; jobId: string; duration: number; key: string; credits: number }, signal?: AbortSignal) {
    requireOnline();
    try {
        return outcome(await api.request<SpeechOutcome>(SPEECH_PATH, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: { type: 'job', jobId: input.jobId }, duration: input.duration, idempotencyKey: input.key, expectedCredits: input.credits }) }, { owner: input.account }));
    } catch (error) {
        if (signal?.aborted) throw error;
        if (error instanceof ApiError && (error.body.refunded === true || (error.status > 0 && error.status < 500 && error.code !== 'bad_response'))) throw error;
        try { return await recoverSpeech(api, input.key, input.account, signal); } catch { throw new ApiError(503, 'outcome_pending'); }
    }
}
export async function pollSpeech(api: ApiClient, key: string, account: string, signal: AbortSignal, progress: (value: 'queued' | 'transcribing') => void): Promise<SpeechOutcome> {
    const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal]);
    active.add(controller);
    let timer: ReturnType<typeof setTimeout>;
    const stopped = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new ApiError(408, 'poll_timeout')); controller.abort(); }, 180000);
    });
    const abort = new Promise<never>((_, reject) => combined.addEventListener('abort', () => reject(new ApiError(0, 'cancelled')), { once: true }));
    void abort.catch(() => {}); // Account changes may stop before the first awaited iteration.
    try {
        let delay = 1000;
        while (!combined.aborted && getCacheUser() === account) {
            const value = await Promise.race([recoverSpeech(api, key, account, combined), stopped, abort]);
            // Never serve memory as an ownership/retention check; every preview follows a fresh owner-only read.
            results.set(scope(account, value.id), value);
            if (results.size > 50) results.delete(results.keys().next().value!);
            if (value.status !== 'queued') return value;
            progress(value.progress === 'transcribing' ? 'transcribing' : 'queued');
            let pauseTimer: ReturnType<typeof setTimeout> | undefined;
            try { await Promise.race([new Promise(resolve => { pauseTimer = setTimeout(resolve, delay); }), stopped, abort]); }
            finally { if (pauseTimer) clearTimeout(pauseTimer); }
            delay = Math.min(10000, delay * 1.6);
        }
        throw new ApiError(0, 'cancelled');
    } finally { clearTimeout(timer!); active.delete(controller); controller.abort(); }
}
export function speechMessage(error: unknown): string {
    if (error instanceof OfflineError) return OFFLINE_PAID_MESSAGE;
    const code = error instanceof ApiError ? error.code : '';
    const messages: Record<string, string> = { source_too_long: 'editorSpeech.tooLong', source_unsupported: 'editorSpeech.unsupported', duration_mismatch: 'editorSpeech.durationChanged',
        result_expired: 'editorAi.expired', poll_timeout: 'editorSpeech.timeout', outcome_pending: 'editorSpeech.timeout', price_changed: 'editorSpeech.priceChanged', speech_cut_unavailable: 'editorSpeech.unavailable', provider_admission_paused: 'editorSpeech.unavailable',
        account_frozen: 'accountDeletion.youraccountisfrozenContactsupportto', insufficient_balance: 'editorAi.balance', subscription_required: 'editorAi.subscription',
        consent_declined: 'editorAi.consent', rate_limited: 'editorAi.rateLimited', idempotency_conflict: 'editorAi.conflict' };
    return t(messages[code] || 'editorSpeech.failed');
}
