import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from '../api';
import { isDefinitivePublicError } from './publicAttempts';
import { publishSong, unpublishSong } from './publicationClient';
import type { PublishInput } from './validatePublication';
export function createPublicationAttempts(api: ApiClient, song: string, mint = randomUUID) {
    let pending: { key: string; input: PublishInput } | null = null, flight: Promise<void> | null = null, epoch = 0;
    return {
        snapshot: () => pending,
        reset() { ++epoch; pending = null; flight = null; },
        publish(input: PublishInput) {
            if (flight) return flight;
            if (pending && JSON.stringify(pending.input) !== JSON.stringify(input)) return Promise.reject(new ApiError(409, 'pending_result'));
            pending ??= { key: `music.publish.${mint()}`, input: Object.freeze({ ...input }) };
            const attempt = pending, ticket = epoch;
            flight = Promise.resolve().then(() => {
                if (ticket !== epoch) throw new ApiError(401, 'account_changed');
                return publishSong(api, song, attempt.input, attempt.key);
            }).then(() => { if (ticket === epoch) pending = null; }).catch(error => {
                if (ticket === epoch && isDefinitivePublicError(error)) pending = null;
                throw error;
            }).finally(() => { if (ticket === epoch) flight = null; });
            return flight;
        },
        // DELETE ignores its key on the server. Never retain or replay it, even after an unknown result.
        unpublish() {
            if (pending || flight) return Promise.reject(new ApiError(409, 'pending_result'));
            return unpublishSong(api, song, `music.unpublish.${mint()}`);
        },
    };
}
