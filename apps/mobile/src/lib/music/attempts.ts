import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from '../api';
import { startGeneration } from './client';
import type { MusicGeneration, MusicInputSnapshot, MusicQuote } from './types';
export type GenerationAttempt = Readonly<{
    quote: MusicQuote; key: string; input: MusicInputSnapshot; phase: 'UNSUBMITTED' | 'AMBIGUOUS';
}>;
// Explicit server rejections of this request. Authentication/authorization failures and
// unknown codes cannot establish what happened to an earlier ambiguous submission.
const DEFINITIVE_REJECTIONS = new Set([
    'quote_expired', 'quote_stale', 'quote_already_used', 'insufficient_balance', 'prompt_not_allowed',
    'invalid_request', 'invalid_inputs', 'quote_id_invalid', 'idempotency_key_invalid',
    'idempotency_conflict', 'revision_conflict', 'invalid_json', 'body_too_large', 'not_found', 'no_balance_row',
]);
export function createGenerationAttempts(api: ApiClient, mintKey = randomUUID) {
    let pending: GenerationAttempt | null = null;
    let flight: Promise<MusicGeneration> | null = null;
    let epoch = 0;
    const listeners = new Set<() => void>();
    const emit = () => listeners.forEach(fn => fn());
    const reset = () => { epoch++; pending = null; flight = null; emit(); };
    function prepare(quote: MusicQuote, input: MusicInputSnapshot) {
        if (pending?.quote.quote_id === quote.quote_id) return pending;
        if (pending?.phase === 'AMBIGUOUS' || flight) throw new Error('pending_result');
        pending = Object.freeze({ quote: Object.freeze({ ...quote }), key: mintKey(), input: Object.freeze({ ...input }), phase: 'UNSUBMITTED' });
        emit(); return pending;
    }
    return {
        snapshot: () => pending,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        prepare, reset, dismiss: reset,
        invalidate() { if (pending?.phase === 'UNSUBMITTED' && !flight) reset(); },
        confirm(quote: MusicQuote): Promise<MusicGeneration> {
            if (flight) return flight;
            if (!pending || pending.quote.quote_id !== quote.quote_id) return Promise.reject(new Error('quote_missing'));
            if (pending.phase === 'UNSUBMITTED' && Date.parse(quote.expires_at) <= Date.now()) return Promise.reject(new ApiError(409, 'quote_expired'));
            const attempt = pending, ticket = epoch;
            pending = Object.freeze({ ...attempt, phase: 'AMBIGUOUS' }); emit();
            flight = startGeneration(api, quote.quote_id, attempt.key).then(result => {
                if (ticket !== epoch) throw new ApiError(401, 'account_changed');
                pending = null; emit(); return result;
            }).catch(error => {
                if (ticket === epoch) {
                    if (error instanceof ApiError && ['consent_declined', 'subscription_required'].includes(error.code)) {
                        // A local guard stopped this send; it says nothing about a previous lost acknowledgement.
                        pending = attempt;
                    } else if (error instanceof ApiError && error.code === 'concurrency_limit') {
                        pending = Object.freeze({ ...attempt, phase: 'UNSUBMITTED' });
                    } else if (error instanceof ApiError && [400, 402, 404, 409, 413].includes(error.status) && DEFINITIVE_REJECTIONS.has(error.code)) {
                        pending = null;
                    }
                    emit();
                }
                throw error;
            }).finally(() => { if (ticket === epoch) flight = null; });
            return flight;
        },
    };
}
