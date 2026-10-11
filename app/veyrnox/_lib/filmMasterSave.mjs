const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SAVE_ERRORS = {
    source_not_found: 'The original take is no longer available in your Library.',
    upload_expired: 'The upload expired. Try Save to Library again.',
    upload_budget_exceeded: 'You have too many pending uploads. Try again later.',
    master_limit: 'Your Library has reached its limit of 100 Film Studio masters.',
    invalid_master_media: 'This file did not pass the 1920×1080, 24 fps MP4 checks. Prepare the master again.',
    master_mismatch: 'The uploaded video did not match the prepared master. Try again.',
    save_not_allowed: 'Saving is unavailable for this account. Contact support.',
    save_not_available: 'Saving to Library is temporarily unavailable. You can still download your master.',
    account_changed: 'Your account changed. Prepare the master again in the current account.',
    no_token: 'Sign in to save your master to Library.',
    unauthenticated: 'Sign in to save your master to Library.',
};
export async function saveFilmMaster({ blob, jobId, label, uploadId, consent, signal, onProgress = () => {}, fetcher, transfer = fetch }) {
    if (!UUID.test(jobId || '') || !UUID.test(uploadId || '') || !consent) throw new Error('Confirm your rights to this Library take before saving.');
    if (!blob?.size || blob.size > 25 * 1024 * 1024) throw new Error('Library masters must be no larger than 25 MiB. You can still download this file.');
    signal?.throwIfAborted(); onProgress('Checking master…');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
    signal?.throwIfAborted();
    const grant = await fetcher('/library/masters/upload', { method: 'POST', signal, body: JSON.stringify({ upload_id: uploadId,
        source_job_id: jobId, sha256: hash, size_bytes: blob.size, label: label.slice(0, 160), rights_confirmed: true }) });
    let result = grant;
    if (!grant?.saved) {
        if (!grant?.ticket || !grant?.upload_url || !grant?.headers) throw new Error('Could not start the save. Try again.');
        onProgress('Uploading master…');
        const upload = await transfer(grant.upload_url, { method: 'PUT', credentials: 'omit', signal, headers: grant.headers, body: blob });
        // A replayed write-once PUT may already have succeeded. The server still
        // hashes the stored bytes before it can register anything.
        if (!upload.ok && upload.status !== 412) throw new Error('The video could not be uploaded. Try Save to Library again.');
        signal?.throwIfAborted(); onProgress('Verifying and saving…');
        result = await fetcher('/library/masters', { method: 'POST', signal, body: JSON.stringify({ ticket: grant.ticket }) });
    }
    if (!result?.saved || !UUID.test(result.id || '')) throw new Error('The save could not be confirmed. Try again.');
    return { id: result.id, url: `/app/library#master-${result.id}`, idempotent: result.idempotent };
}
