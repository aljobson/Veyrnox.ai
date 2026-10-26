// Pure browser contract: prices always come from the server, never arithmetic here.
export const SERVER_RENDER_PATH = '/editor/server-render';
export const serverResolution = height => height === 720 ? '720p' : height === 1080 ? '1080p' : null;
export function serverRenderVisible(mode, storage) {
    if (!['preview', 'on'].includes(mode)) return false;
    try { return storage?.getItem('veyrnox_editor_server_render') === '1'; } catch { return false; }
}
export function serverRenderDisabled(document, height, label) {
    if (!document?.project_id || ![2, 3].includes(document.schema_version)) return 'saveFirst';
    if (!serverResolution(height)) return 'supportedSizes';
    if (typeof label !== 'string' || !label.trim() || label.length > 160 || /[\u0000-\u001f\u007f]/.test(label)) return 'invalidName';
    return null;
}
const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
};
export function renderSnapshot(document, height, label) {
    if (serverRenderDisabled(document, height, label)) return null;
    return freeze(JSON.parse(JSON.stringify({ document, resolution: serverResolution(height), label })));
}
export const snapshotIdentity = snapshot => JSON.stringify(snapshot);
export const quoteRequest = snapshot => ({ method: 'POST', body: JSON.stringify({ document: snapshot.document, resolution: snapshot.resolution }) });
export function renderAttempt(snapshot, quote, key) {
    if (!snapshot || quote.resolution !== snapshot.resolution || !Number.isSafeInteger(quote.credits) || quote.credits < 1) throw new Error('invalid_quote');
    return freeze({ snapshot, key, request: { method: 'POST', headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ ...snapshot, quoted_credits: quote.credits }) }, credits: quote.credits });
}
export function renderStatus(response) {
    const state = response?.state;
    const phase = ['STORED', 'succeeded'].includes(state) ? 'done'
        : ['REFUNDED', 'FAILED', 'failed'].includes(state) ? 'failed'
            : ['SUBMITTED', 'SUCCEEDED', 'running'].includes(state) ? 'rendering' : 'queued';
    return { jobId: response?.job_id, renderId: response?.render_id || null, phase,
        refunded: state === 'REFUNDED' || response?.refunded === true, credits: response?.credits,
        error: response?.error_code || response?.error || null };
}
export const terminalRender = job => ['done', 'failed'].includes(job?.phase);
export function renderPollDelay(count, visible, job, statusUnavailable = false) {
    if (!visible || terminalRender(job) || statusUnavailable) return null;
    return Math.min(10000, 3000 + Math.max(0, count) * 1000);
}
// Success resets the streak. Access/not-found failures cannot recover by polling.
export function renderPollOutcome(failures, error = null) {
    if (!error) return { failures: 0, statusUnavailable: false };
    const next = failures + 1;
    return { failures: next, statusUnavailable: [403, 404].includes(error.status) || next >= 5 };
}
export const retryRenderTransport = error => ['network_error', 'gateway_error', 'internal'].includes(error?.code);
const ERRORS = Object.freeze({
    upload_budget_exceeded: 'uploadBudget', too_many_pending_uploads: 'uploadBudget',
    upload_admission_unavailable: 'uploadAdmission', upload_consent_expired: 'uploadExpired',
    upload_reservation_unavailable: 'uploadUnavailable', upload_invalid_grant: 'uploadUnavailable', upload_failed: 'uploadFailed',
    upload_unreadable: 'uploadInvalid', upload_type_mismatch: 'uploadInvalid',
    render_busy: 'busy', editor_render_unsupported: 'unsupported', editor_render_duration_limit: 'duration',
    editor_render_clip_limit: 'clips', editor_render_media_not_owned: 'ownership', editor_render_upload_incomplete: 'upload',
    insufficient_balance: 'balanceLow', rate_limited: 'rate', runner_submit_failed: 'submitFailed',
    render_invalid: 'invalid', invalid_render: 'invalid', editor_render_invalid_document: 'invalid',
    render_too_large: 'tooLarge', render_refunded: 'refunded', editor_server_render_disabled: 'disabled',
    not_enabled: 'disabled', preview_only: 'previewOnly', price_changed: 'priceChanged', job_finished: 'finished',
});
export function renderError(error) {
    const code = error?.code || error?.error;
    if (error?.status === 403 && code === 'editor_render_media_not_owned' && error.uploadedLocalFiles === true) return 'app.editor.server.uploadExpired';
    return `app.editor.server.${error?.status === 501 ? 'disabled' : Object.hasOwn(ERRORS, code) ? ERRORS[code] : 'failed'}`;
}
// Server-supplied feature names select known translated labels, never raw text.
export function renderFeature(feature) {
    if (typeof feature !== 'string') return 'app.editor.server.feature.edit';
    const labels = { reverse: 'app.editor.speed.reverse', crop: 'app.editor.controls.cropMask', mask: 'app.editor.mask.title',
        rotation: 'app.editor.controls.rotation', opacity: 'app.editor.controls.opacity', transform: 'app.editor.controls.transform',
        flipX: 'app.editor.controls.flipX', flipY: 'app.editor.controls.flipY', filter: 'app.editor.rail.filters',
        audioProcessing: 'app.editor.server.feature.audio', preservePitch: 'app.editor.server.feature.audio',
        fadeIn: 'app.editor.server.feature.audio', fadeOut: 'app.editor.server.feature.audio',
        picture: 'app.editor.animation.picture', motion: 'app.editor.animation.motion' };
    if (Object.hasOwn(labels, feature)) return labels[feature];
    if (feature.startsWith('text.')) return 'app.editor.server.feature.text';
    if (feature.startsWith('media.')) return 'app.editor.server.feature.media';
    const features = { schemaVersion: 'version', 'canvas.frame_rate': 'frameRate', transitionType: 'transition',
        multiple_tracks: 'tracks', track_visibility: 'visibility', overlapping_clips: 'overlap',
        background: 'background', source_aspect: 'aspect', speed: 'speed', rate: 'speed', speedCurve: 'speed',
        volume: 'audio', audio: 'audio', audioEffects: 'audio', animation: 'animation', keyframes: 'animation' };
    return `app.editor.server.feature.${Object.hasOwn(features, feature) ? features[feature] : 'edit'}`;
}
export const renderLibraryHref = renderId => `/app/library${renderId ? `#render-${encodeURIComponent(renderId)}` : ''}`;
export const renderDownloadPath = renderId => `/library/editor-renders/${encodeURIComponent(renderId)}/asset?download=1`;

/** A network retry must resend the same immutable request, never quote or mint a key. */
export async function sendRenderAttempt(call, attempt, isCurrent = () => true) {
    for (let tries = 0; tries < 2; tries++) {
        try {
            const response = await call(SERVER_RENDER_PATH, attempt.request);
            if (!response?.job_id) throw Object.assign(new Error('unreadable_response'), { code: 'gateway_error' });
            return response;
        }
        catch (error) { if (!isCurrent() || tries || !retryRenderTransport(error)) throw error; }
    }
}
