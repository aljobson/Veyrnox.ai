export const MCP_MUSIC_PLAYLIST_MAX_SONGS = 75;

const REQUEST_PENDING = new Set(['debited', 'running']);
const REQUEST_TERMINAL = new Set(['partial', 'succeeded', 'failed', 'refunded']);
const CANDIDATE_PENDING = new Set(['queued', 'running']);

/** True only while another owned generation read could still change this request. */
export function musicGenerationPending(generation) {
    if (REQUEST_TERMINAL.has(generation?.state)) return false;
    if (REQUEST_PENDING.has(generation?.state)) return true;
    return Array.isArray(generation?.candidates)
        && generation.candidates.some((candidate) => CANDIDATE_PENDING.has(candidate?.state));
}

export function musicAssetError(response, data) {
    const header = Number(response?.headers?.get?.('retry-after'));
    const body = Number(data?.retry_after_seconds);
    const retryAfter = Number.isInteger(body) && body > 0
        ? body : Number.isInteger(header) && header > 0 ? header : null;
    return {
        error: data?.error || `http_${response?.status || 500}`,
        status: response?.status || 500,
        ...(retryAfter ? { retry_after_seconds: retryAfter } : {}),
    };
}
