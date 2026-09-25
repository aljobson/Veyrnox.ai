import { ApiError } from './errors.js';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** @param {unknown} value @returns {string} */
export function uuid(value) {
    if (typeof value !== 'string' || !UUID_RE.test(value)) throw new ApiError(400, 'INVALID_ID', 'A valid resource ID is required.');
    return value;
}
/** Stream cap also covers requests with absent or dishonest Content-Length.
 * @param {Request} request @param {number} [maxBytes]
 */
export async function readBody(request, maxBytes = 16384) {
    const declared = request.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body exceeds the limit.');
    const reader = request.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                await reader.cancel();
                throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body exceeds the limit.');
            }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}
/** @param {Request} request @param {number} [maxBytes] @returns {Promise<Record<string, unknown>>} */
export async function readJson(request, maxBytes) {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'JSON_REQUIRED', 'Content-Type must be application/json.');
    const bytes = await readBody(request, maxBytes);
    try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        return value;
    } catch { throw new ApiError(400, 'INVALID_JSON', 'A JSON object is required.'); }
}
/** @param {Record<string, unknown>} body @param {string[]} allowed */
export function exactKeys(body, allowed) {
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, 'UNKNOWN_FIELD', 'The request contains unsupported fields.');
}
/** @param {unknown} value */
export function projectName(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 120 || /[\u0000-\u001f]/.test(value)) throw new ApiError(400, 'INVALID_NAME', 'Project name must contain 1–120 characters.');
    return value.trim();
}
/** @param {Request} request @param {unknown} [legacy] */
export function idempotencyKey(request, legacy) {
    const header = request.headers.get('idempotency-key');
    const key = header ?? legacy;
    if (typeof key !== 'string' || !/^[A-Za-z0-9._-]{8,128}$/.test(key) || (header && legacy !== undefined && header !== legacy)) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'A consistent Idempotency-Key of 8–128 characters is required.');
    return key;
}
