import { ApiError } from '../api';
import { t } from '../i18n';

// Explicit refusals from render/route.js, musicEditing.js, musicWavRender.js,
// and the context/commit RPCs in 0485/0486/0534. Unknown errors stay ambiguous.
export const RENDER_DEFINITIVE_CODES = [
    'not_authenticated', 'song_id_invalid', 'music_editing_unavailable', 'music_reverse_unavailable',
    'gateway_not_configured', 'body_too_large', 'invalid_json', 'invalid_request', 'operation_invalid',
    'version_id_invalid', 'idempotency_key_invalid', 'fade_range_invalid', 'speed_ratio_invalid',
    'reorder_range_invalid', 'remaster_target_invalid', 'not_found', 'invalid_inputs',
    'idempotency_conflict', 'revision_conflict', 'render_format_unsupported', 'source_too_large',
    'source_duration_unavailable', 'source_unavailable', 'source_changed', 'wav_invalid',
    'wav_format_unsupported', 'remaster_silence', 'render_storage_failed',
] as const;
export const isDefinitiveRenderError = (error: unknown) => error instanceof ApiError && error.status >= 400
    && (RENDER_DEFINITIVE_CODES as readonly string[]).includes(error.code);
const PRE_COMMIT_REFUSALS = ['not_authenticated', 'music_editing_unavailable', 'music_reverse_unavailable', 'gateway_not_configured'];
export const isPreCommitRefusal = (error: unknown) => error instanceof ApiError && PRE_COMMIT_REFUSALS.includes(error.code);
const messages = {
    not_authenticated: 'auth', not_found: 'missing', song_id_invalid: 'missing',
    music_editing_unavailable: 'editingOff', music_reverse_unavailable: 'reverseOff',
    gateway_not_configured: 'service', temporarily_unavailable: 'uncertain', service_unavailable: 'uncertain',
    body_too_large: 'request', invalid_json: 'request', invalid_request: 'request', operation_invalid: 'request',
    version_id_invalid: 'request', idempotency_key_invalid: 'request', invalid_inputs: 'request',
    fade_range_invalid: 'fadeRange', speed_ratio_invalid: 'speedRange', reorder_range_invalid: 'splitRange',
    remaster_target_invalid: 'peakRange', idempotency_conflict: 'conflict', revision_conflict: 'changed', source_changed: 'changed',
    render_format_unsupported: 'format', wav_format_unsupported: 'format', wav_invalid: 'wav', source_too_large: 'size',
    source_duration_unavailable: 'duration', source_unavailable: 'source', remaster_silence: 'silence', render_storage_failed: 'storage',
    duration_required: 'measure', offline: 'offline', network: 'uncertain', bad_response: 'uncertain', refresh_failed: 'refreshFailed',
} as const;
export function renderMessage(code: string) {
    return t(`musicRender.${messages[code as keyof typeof messages] ?? 'uncertain'}`);
}
