import { ApiError, type ApiClient } from '../api';
import { publicUuid } from './validatePublic';
import { isPublicationRead, isPublishInput, isPublishReceipt, isUnpublishReceipt, publicationRequestValid, type PublishInput } from './validatePublication';
const path = (song: string) => `/api/v1/music/songs/${encodeURIComponent(song)}/publication`;
export async function getPublication(api: ApiClient, song: string) {
    if (!publicUuid(song)) throw new ApiError(400, 'song_id_invalid');
    const value = await api.request<unknown>(path(song), undefined, { timeoutMs: 30_000 });
    if (!isPublicationRead(value)) throw new ApiError(200, 'bad_response');
    return value.publication;
}
export async function publishSong(api: ApiClient, song: string, input: PublishInput, key: string): Promise<void> {
    if (!publicationRequestValid(song, key) || !isPublishInput(input)) throw new ApiError(400, 'invalid_request');
    const value = await api.request<unknown>(path(song), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, idempotency_key: key }) }, { timeoutMs: 30_000 });
    if (!isPublishReceipt(value)) throw new ApiError(200, 'bad_response');
}
export async function unpublishSong(api: ApiClient, song: string, key: string): Promise<void> {
    if (!publicationRequestValid(song, key)) throw new ApiError(400, 'invalid_request');
    const value = await api.request<unknown>(path(song), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: key }) }, { timeoutMs: 30_000 });
    if (!isUnpublishReceipt(value)) throw new ApiError(200, 'bad_response');
}
