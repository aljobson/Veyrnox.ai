import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from '../api';
import { writePublic } from './publicClient';
import type { PublicWrite, WriteReceipt } from './publicTypes';
const DEFINITIVE = new Set(['invalid_request', 'invalid_inputs', 'idempotency_key_invalid', 'idempotency_conflict',
    'slug_invalid', 'handle_invalid', 'reaction_invalid', 'following_invalid', 'body_invalid', 'at_seconds_invalid',
    'parent_id_invalid', 'comment_id_invalid', 'category_invalid', 'details_invalid', 'comments_closed', 'self_review',
    'own_song', 'already_reviewed', 'limit_reached', 'source_removed']);
export function createPublicAttempts(api: ApiClient, mint = randomUUID) {
    let pending: Readonly<{ key: string; write: PublicWrite }> | null = null, flight: Promise<WriteReceipt> | null = null, epoch = 0;
    return {
        snapshot: () => pending,
        reset() { epoch++; pending = null; flight = null; },
        run(write: PublicWrite) {
            if (flight) return flight;
            if (pending && JSON.stringify(pending.write) !== JSON.stringify(write)) return Promise.reject(new ApiError(409, 'pending_result'));
            if (!pending) pending = Object.freeze({ key: `music.public.${mint()}`, write: Object.freeze(JSON.parse(JSON.stringify(write))) as PublicWrite });
            const attempt = pending, ticket = epoch;
            flight = Promise.resolve().then(() => {
                if (ticket !== epoch) throw new ApiError(401, 'account_changed');
                return writePublic(api, attempt.write, attempt.key);
            }).then(v => {
                if (ticket !== epoch) throw new ApiError(401, 'account_changed');
                pending = null; return v;
            }).catch(e => {
                if (ticket === epoch && e instanceof ApiError && e.status >= 400 && e.status < 500 && DEFINITIVE.has(e.code)) pending = null;
                throw e;
            }).finally(() => { if (ticket === epoch) flight = null; });
            return flight;
        },
    };
}
