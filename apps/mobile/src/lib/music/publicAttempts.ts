import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from '../api';
import { writePublic } from './publicClient';
import type { PublicWrite, WriteReceipt } from './publicTypes';
export const isDefinitivePublicError = (error: unknown): error is ApiError => error instanceof ApiError
    && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
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
                if (ticket === epoch && isDefinitivePublicError(e)) pending = null;
                throw e;
            }).finally(() => { if (ticket === epoch) flight = null; });
            return flight;
        },
    };
}
