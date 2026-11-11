const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,120}$/;

export function parseMusicCrop(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'end_seconds,idempotency_key,start_seconds,version_id') {
        return { ok: false, error: 'invalid_request' };
    }
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    if (!Number.isFinite(value.start_seconds) || !Number.isFinite(value.end_seconds)
        || value.start_seconds < 0 || value.end_seconds <= value.start_seconds
        || value.start_seconds > 86400 || value.end_seconds > 86400) {
        return { ok: false, error: 'crop_range_invalid' };
    }
    if (value.end_seconds - value.start_seconds < 1) return { ok: false, error: 'crop_too_short' };
    if (typeof value.idempotency_key !== 'string' || !IDEMPOTENCY_RE.test(value.idempotency_key)) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    return { ok: true, versionId: value.version_id.toLowerCase(), start: value.start_seconds, end: value.end_seconds, idempotencyKey: value.idempotency_key };
}

export function parseMusicLocalRender(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'invalid_request' };
    const common = ['idempotency_key', 'operation', 'version_id'];
    if (!['fade', 'speed', 'reorder', 'remaster'].includes(value.operation)) return { ok: false, error: 'operation_invalid' };
    const expected = value.operation === 'fade'
        ? [...common, 'fade_in_seconds', 'fade_out_seconds'].sort()
        : value.operation === 'speed'
            ? [...common, 'speed_ratio'].sort()
            : value.operation === 'reorder'
                ? [...common, 'split_seconds', 'order'].sort()
                : [...common, 'target_peak_dbfs'].sort();
    if (Object.keys(value).sort().join(',') !== expected.join(',')) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    if (typeof value.idempotency_key !== 'string' || !IDEMPOTENCY_RE.test(value.idempotency_key)) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    if (value.operation === 'fade') {
        if (!Number.isFinite(value.fade_in_seconds) || !Number.isFinite(value.fade_out_seconds)
            || value.fade_in_seconds < 0 || value.fade_out_seconds < 0
            || value.fade_in_seconds > 30 || value.fade_out_seconds > 30
            || value.fade_in_seconds + value.fade_out_seconds <= 0) {
            return { ok: false, error: 'fade_range_invalid' };
        }
        return {
            ok: true, operation: 'fade', versionId: value.version_id.toLowerCase(),
            parameters: { fade_in_seconds: value.fade_in_seconds, fade_out_seconds: value.fade_out_seconds },
            idempotencyKey: value.idempotency_key,
        };
    }
    if (value.operation === 'speed') {
        if (!Number.isFinite(value.speed_ratio) || value.speed_ratio < 0.5 || value.speed_ratio > 2
            || Math.abs(value.speed_ratio - 1) < 0.000001) {
            return { ok: false, error: 'speed_ratio_invalid' };
        }
        return {
            ok: true, operation: 'speed', versionId: value.version_id.toLowerCase(),
            parameters: { speed_ratio: value.speed_ratio }, idempotencyKey: value.idempotency_key,
        };
    }
    if (value.operation === 'reorder') {
        if (!Number.isFinite(value.split_seconds) || value.split_seconds < 1 || value.split_seconds > 86399
            || !Array.isArray(value.order) || value.order.length !== 2 || value.order[0] !== 2 || value.order[1] !== 1) {
            return { ok: false, error: 'reorder_range_invalid' };
        }
        return {
            ok: true, operation: 'reorder', versionId: value.version_id.toLowerCase(),
            parameters: { split_seconds: value.split_seconds, order: [2, 1] }, idempotencyKey: value.idempotency_key,
        };
    }
    if (![-3, -2, -1].includes(value.target_peak_dbfs)) return { ok: false, error: 'remaster_target_invalid' };
    return {
        ok: true, operation: 'remaster', versionId: value.version_id.toLowerCase(),
        parameters: { target_peak_dbfs: value.target_peak_dbfs }, idempotencyKey: value.idempotency_key,
    };
}
