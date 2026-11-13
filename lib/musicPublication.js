import { isUuid } from './validate.js';
const HANDLE_RE = /^[a-z][a-z0-9_]{2,29}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,120}$/;

function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

export function parseMusicPublish(value) {
    const keys = ['allow_comments', 'allow_remixes', 'display_name', 'handle', 'idempotency_key', 'rights_confirmed', 'version_id'];
    if (!exact(value, keys)) return { ok: false, error: 'invalid_request' };
    const handle = typeof value.handle === 'string' ? value.handle.trim().toLowerCase() : '';
    const displayName = typeof value.display_name === 'string' ? value.display_name.trim() : '';
    if (!isUuid(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    if (!HANDLE_RE.test(handle)) return { ok: false, error: 'handle_invalid' };
    if (!displayName || displayName.length > 80 || /[\u0000-\u001f]/.test(displayName)) {
        return { ok: false, error: 'display_name_invalid' };
    }
    if (typeof value.allow_comments !== 'boolean' || typeof value.allow_remixes !== 'boolean') {
        return { ok: false, error: 'permissions_invalid' };
    }
    if (value.rights_confirmed !== true) return { ok: false, error: 'rights_confirmation_required' };
    if (typeof value.idempotency_key !== 'string' || !IDEMPOTENCY_RE.test(value.idempotency_key)) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    return {
        ok: true,
        versionId: value.version_id.toLowerCase(),
        handle,
        displayName,
        allowComments: value.allow_comments,
        allowRemixes: value.allow_remixes,
        idempotencyKey: value.idempotency_key,
    };
}

export function parseMusicUnpublish(value) {
    if (!exact(value, ['idempotency_key']) || typeof value.idempotency_key !== 'string'
        || !IDEMPOTENCY_RE.test(value.idempotency_key)) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    return { ok: true, idempotencyKey: value.idempotency_key };
}
