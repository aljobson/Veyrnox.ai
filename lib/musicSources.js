import { isUuid } from './validate.js';
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,120}$/;

export const MUSIC_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const MUSIC_SOURCE_TYPES = Object.freeze({
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
});

function exactKeys(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

export function parseMusicSourceMutation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'invalid_request' };
    if (value.action === 'reserve') {
        const keys = ['action', 'content_type', 'filename', 'idempotency_key', 'rights_confirmed', 'size_bytes'];
        if (!exactKeys(value, keys)) return { ok: false, error: 'invalid_request' };
        const filename = typeof value.filename === 'string' ? value.filename.trim() : '';
        const contentType = typeof value.content_type === 'string' ? value.content_type.trim().toLowerCase() : '';
        if (!filename || filename.length > 180 || /[\u0000-\u001f]/.test(filename)) return { ok: false, error: 'filename_invalid' };
        if (!Object.hasOwn(MUSIC_SOURCE_TYPES, contentType)) return { ok: false, error: 'source_type_not_supported' };
        if (!Number.isSafeInteger(value.size_bytes) || value.size_bytes < 1 || value.size_bytes > MUSIC_SOURCE_MAX_BYTES) {
            return { ok: false, error: 'source_size_invalid' };
        }
        if (value.rights_confirmed !== true) return { ok: false, error: 'rights_confirmation_required' };
        if (typeof value.idempotency_key !== 'string' || !IDEMPOTENCY_RE.test(value.idempotency_key)) {
            return { ok: false, error: 'idempotency_key_invalid' };
        }
        return {
            ok: true,
            action: 'reserve',
            filename,
            contentType,
            sizeBytes: value.size_bytes,
            idempotencyKey: value.idempotency_key,
        };
    }
    if (value.action === 'complete') {
        if (!exactKeys(value, ['action', 'id'])) return { ok: false, error: 'invalid_request' };
        if (typeof value.id !== 'string' || !isUuid(value.id)) return { ok: false, error: 'source_id_invalid' };
        return { ok: true, action: 'complete', id: value.id.toLowerCase() };
    }
    return { ok: false, error: 'invalid_request' };
}

export function parseMusicSourceDelete(value) {
    if (!exactKeys(value, ['id']) || typeof value.id !== 'string' || !isUuid(value.id)) {
        return { ok: false, error: 'source_id_invalid' };
    }
    return { ok: true, id: value.id.toLowerCase() };
}
