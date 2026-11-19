// Pure transport adapter: the caller supplies the authenticated API fetch, a SEPARATE plain fetch
// for the presigned storage upload (it must never carry our credentials), and a negotiated session.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const error = code => Object.assign(new Error(code), { code });
const normalise = code => typeof code === 'string' && /^[a-z_-]{3,60}$/i.test(code)
    ? code.toLowerCase().replaceAll('_', '-') : 'request-failed';
const INSPECT_BACKOFF_MS = [1000, 2000, 4000]; // of the order of one inspection, with jitter
const defaultNonce = () => { const b = new Uint8Array(4); globalThis.crypto.getRandomValues(b); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); };
/** A label the server accepts: no separators or control characters, at most 120 code points. */
export function safeLabel(name) {
    const cleaned = [...String(name ?? '').replace(/[/\\\u0000-\u001f\u007f-\u009f]/gu, ' ')].slice(0, 120).join('').trim();
    return cleaned || 'project.fcproj';
}
export function createProEditorStorage({ projectId, sessionId, fetch: apiFetch, uploadFetch, sleep = ms => new Promise(r => setTimeout(r, ms)), jitter = () => Math.random(), nonce = defaultNonce }) {
    if (!UUID.test(projectId) || !/^[0-9a-f]{32}$/.test(sessionId) || typeof apiFetch !== 'function' || typeof uploadFetch !== 'function' || uploadFetch === apiFetch) throw error('invalid-storage-context');
    // Per adapter, so two adapters or trackers for one session (a remount) never share a key.
    const instance = nonce();
    if (!/^[0-9a-f]{8}$/.test(instance)) throw error('invalid-storage-context');
    const base = `/api/v1/projects/${projectId}/pro`;
    const attempts = new Map();
    async function request(path, method, body, key) {
        let response;
        try { response = await apiFetch(base + path, { method, redirect: 'error', headers: {
            'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}),
        }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
        catch { throw error('network-failed'); }
        let data;
        try { data = await response.json(); } catch { throw Object.assign(error('invalid-response'), { status: response.status }); }
        if (!response.ok) {
            const code = normalise(data?.error?.code);
            throw Object.assign(error(code === 'version-conflict' ? 'revision-conflict' : code), { status: response.status });
        }
        return data;
    }
    function available(data) {
        if (!data || typeof data !== 'object') throw error('invalid-response');
        if (['claimed', 'purged'].includes(data.cleanup_state)) throw error('file-unavailable');
        if (data.cleanup_state !== 'live') throw error('invalid-response');
    }
    function verify(data, candidate, fileId) {
        if (!data || !UUID.test(data.file_id) || (fileId && data.file_id !== fileId)) throw error('invalid-response');
        available(data);
        if (data.state !== 'inspected') throw error(data.state === 'rejected' ? 'file-rejected' : 'file-not-inspected');
        if (!HASH.test(data.content_sha256) || data.content_sha256.toLowerCase() !== candidate.sha256.toLowerCase()) throw error('hash-mismatch');
        if (!Number.isSafeInteger(data.byte_size) || data.byte_size !== candidate.byteLength) throw error('size-mismatch');
        return { assetId: data.file_id };
    }
    return {
        async persist(candidate) {
            if (!/^c[1-9][0-9]*$/.test(candidate.id) || !/^[0-9a-f]{8}-c[1-9][0-9]*$/.test(candidate.uid) || !HASH.test(candidate.sha256) || !candidate.bytes || candidate.sessionId !== sessionId) throw error('invalid-candidate');
            let attempt = attempts.get(candidate.uid) || 1;
            while (attempt <= 3) {
                attempts.set(candidate.uid, attempt);
                try {
                    const reserved = await request('/files', 'POST', { label: safeLabel(candidate.name), size_bytes: candidate.byteLength }, `${sessionId}-${instance}-${candidate.uid}-${attempt}`);
                    available(reserved);
                    if (reserved.state !== 'quarantined') return verify(reserved, candidate);
                    if (!UUID.test(reserved.file_id) || typeof reserved.upload_url !== 'string' || !reserved.upload_url.startsWith('https://')) throw error('invalid-response');
                    let uploaded;
                    try { uploaded = await uploadFetch(reserved.upload_url, { method: 'PUT', redirect: 'error', credentials: 'omit',
                        headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' }, body: candidate.bytes }); }
                    catch { throw error('network-failed'); }
                    await uploaded.body?.cancel().catch(() => {});
                    if (!uploaded.ok && uploaded.status !== 412) throw error('upload-failed');
                    for (let retry = 0; retry < 3; retry++) {
                        try { return verify(await request(`/files/${reserved.file_id}/inspect`, 'POST'), candidate, reserved.file_id); }
                        catch (err) {
                            if (err.status !== 503 || retry === 2) throw err;
                            await sleep(Math.round(INSPECT_BACKOFF_MS[retry] * (0.75 + 0.5 * jitter())));
                        }
                    }
                } catch (err) {
                    if (!['upload-closed', 'file-unavailable'].includes(err.code)) throw err;
                    attempt++;
                    attempts.set(candidate.uid, attempt);
                }
            }
            throw error('reservation-limit');
        },
        async commitHead(candidate, expectedRevision) {
            if (!UUID.test(candidate.asset) || !Number.isSafeInteger(expectedRevision ?? 0) || (expectedRevision ?? 0) < 0) throw error('invalid-head');
            const result = await request('/head', 'PUT', { expected_revision: expectedRevision ?? 0, file_id: candidate.asset },
                `${sessionId}-${instance}-${candidate.uid}-head-${expectedRevision ?? 0}`);
            if (!Number.isSafeInteger(result.revision) || result.revision !== (expectedRevision ?? 0) + 1 || result.file_id !== candidate.asset) throw error('invalid-response');
            return result;
        },
    };
}
