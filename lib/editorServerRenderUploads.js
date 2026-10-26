import { checkSniffed, SNIFF_BYTES } from './uploadSource.js';
import { ApiError } from '../packages/security/errors.js';

/** Bounded prefix inspection; never buffer an uploaded video in the Worker. */
export async function validateRenderUpload(row, deps) {
    const object = await deps.get(row.r2_key);
    const response = object?.response;
    const complete = object?.ok && Number(response.headers.get('content-length')) === row.size_bytes
        && response.headers.get('content-type')?.split(';')[0] === row.mime_type;
    if (!complete) {
        await response?.body?.cancel();
        throw new ApiError(409, 'editor_render_upload_incomplete', 'editor_render_upload_incomplete');
    }
    const reader = response.body?.getReader();
    const prefix = new Uint8Array(SNIFF_BYTES);
    let length = 0;
    try {
        while (reader && length < prefix.length) {
            const { done, value } = await reader.read();
            if (done) break;
            const take = Math.min(value.length, prefix.length - length);
            prefix.set(value.subarray(0, take), length); length += take;
        }
    } finally { if (reader) { await reader.cancel(); reader.releaseLock(); } }
    const sniffed = checkSniffed(row.mime_type, prefix.subarray(0, length));
    if (!sniffed.ok) throw new ApiError(409, sniffed.error, sniffed.error);
}
