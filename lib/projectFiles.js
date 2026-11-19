import { scanProProject, PROJECT_MAX_BYTES } from './proProjectScan.mjs';
import { ApiError } from '../packages/security/errors.js';
export { PROJECT_MAX_BYTES };
export const FILE_URL_TTL_SECONDS = 900;
export const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
let inspecting = false;
// Do not queue buffers in an isolate. Busy callers retry through the ordinary 503 path.
export async function withFileInspection(action) {
    if (inspecting) throw new ApiError(503, 'inspection-busy', 'Inspection is temporarily unavailable.');
    inspecting = true;
    try { return await action(); } finally { inspecting = false; }
}
export async function readFileBytes(response, size) {
    if (!response.ok || !response.body) throw Error('read_failed');
    const reader = response.body.getReader();
    const bytes = new Uint8Array(size);
    let offset = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (offset + value.length > size) throw Error('read_size');
            bytes.set(value, offset); offset += value.length;
        }
        if (offset !== size) throw Error('read_size');
        return bytes;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function inspectProjectFile(bytes) {
    const scanned = scanProProject(bytes);
    if (!scanned.ok) return { reject_reason: scanned.reason };
    return { content_sha256: await sha256(bytes), content_fingerprint: await sha256(scanned.projectBytes),
        schema_version: scanned.schemaVersion, byte_size: bytes.byteLength, reject_reason: null };
}
export function fileProjection(file) {
    return { file_id: file.file_id || file.id, state: file.state, cleanup_state: file.cleanup_state,
        content_sha256: file.content_sha256, byte_size: file.byte_size, reject_reason: file.reject_reason,
        idempotent: file.idempotent ?? false };
}
