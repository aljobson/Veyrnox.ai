import { ApiError, type ApiClient } from '../api';
import { parseRender, type RenderInput } from './renderForm';
import { isRenderResult } from './validateRender';

export async function renderSong(api: ApiClient, songId: string, input: RenderInput, key: string) {
    const body = { ...input, idempotency_key: key }, parsed = parseRender(body);
    if (!parsed.ok) throw new ApiError(400, parsed.error);
    const result = await api.request<unknown>(`/api/v1/music/songs/${encodeURIComponent(songId)}/render`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!isRenderResult(result) || result.operation !== input.operation) throw new ApiError(200, 'bad_response');
    return result;
}
