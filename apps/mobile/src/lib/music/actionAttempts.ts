import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from '../api';
import { DEFINITIVE_REJECTIONS } from './attempts';
import type { ActionInput, ActionSpec, MusicActionQuote } from './actionTypes';
export type ActionAttempt = Readonly<{ quote: MusicActionQuote; input: ActionInput; key: string; phase: 'UNSUBMITTED' | 'AMBIGUOUS' }>;
export function createActionAttempts<R extends { balance_after?: number }, S>(api: ApiClient, spec: ActionSpec<R, S>, mintKey = randomUUID) {
    let pending: ActionAttempt | null = null, flight: Promise<R> | null = null, epoch = 0;
    const listeners = new Set<() => void>();
    const emit = () => listeners.forEach(fn => fn());
    const reset = () => { epoch++; pending = null; flight = null; emit(); };
    return {
        snapshot: () => pending,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        reset,
        invalidate() { if (pending?.phase === 'UNSUBMITTED' && !flight) reset(); },
        prepare(quote: MusicActionQuote, input: ActionInput) {
            if (pending?.quote.quote_id === quote.quote_id) return pending;
            if (pending?.phase === 'AMBIGUOUS' || flight) throw new Error('pending_result');
            pending = Object.freeze({ quote: Object.freeze({ ...quote, outputs: Object.freeze([...quote.outputs]) }),
                input: Object.freeze({ ...input }), key: `${spec.keyPrefix}.${mintKey()}`, phase: 'UNSUBMITTED' });
            emit(); return pending;
        },
        confirm(quote: MusicActionQuote): Promise<R> {
            if (flight) return flight;
            if (!pending || pending.quote.quote_id !== quote.quote_id) return Promise.reject(new Error('quote_missing'));
            if (pending.phase === 'UNSUBMITTED') {
                if (Date.parse(quote.expires_at) <= Date.now()) return Promise.reject(new ApiError(409, 'quote_expired'));
                if (!quote.affordable) return Promise.reject(new ApiError(402, 'insufficient_balance'));
            }
            const attempt = pending, ticket = epoch;
            pending = Object.freeze({ ...attempt, phase: 'AMBIGUOUS' }); emit();
            flight = Promise.resolve().then(() => {
                if (ticket !== epoch) throw new ApiError(401, 'account_changed');
                return spec.confirm(api, quote.quote_id, attempt.key);
            }).then(result => {
                if (ticket !== epoch) throw new ApiError(401, 'account_changed');
                pending = null; emit(); return result;
            }).catch(error => {
                if (ticket === epoch) {
                    if (error instanceof ApiError && ['consent_declined', 'subscription_required'].includes(error.code)) pending = attempt;
                    else if (error instanceof ApiError && error.code === 'concurrency_limit') pending = Object.freeze({ ...attempt, phase: 'UNSUBMITTED' });
                    else if (error instanceof ApiError && (
                        ([400, 402, 404, 409, 413].includes(error.status) && DEFINITIVE_REJECTIONS.has(error.code))
                        // The stem RPC maps explicit model/plan/format rejections to 503.
                        || ([400, 402, 404, 409, 413, 503].includes(error.status) && spec.definitiveCodes.has(error.code))
                    )) pending = null;
                    // Unknown outcomes, including stem_acceptance_unknown, retain the original key.
                    emit();
                }
                throw error;
            }).finally(() => { if (ticket === epoch) flight = null; });
            return flight;
        },
    };
}
