'use client';
import { gatewayFetch } from '../veyrnox/_lib/gateway.js';
import { checkSocialUpload } from '../../lib/social/uploadPolicy.js';

export const listSocialUploads = () => gatewayFetch('/social/uploads');
export const removeSocialUpload = (id) => gatewayFetch('/social/uploads', { method: 'DELETE', body: JSON.stringify({ id }) });

export async function uploadSocialFile(file, { onProgress, signal, call = gatewayFetch } = {}) {
    const checked = checkSocialUpload(file.type, file.size);
    if (!checked.ok) throw Object.assign(new Error(checked.error), { code: checked.error });
    const reserved = await call('/social/uploads', {
        method: 'POST', signal, body: JSON.stringify({ action: 'reserve', filename: file.name.slice(0, 180), content_type: file.type, size_bytes: file.size, rights_confirmed: true }),
    });
    try {
        await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const abort = () => xhr.abort();
            const finish = (error) => { signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
            xhr.open('PUT', reserved.upload_url);
            xhr.timeout = 15 * 60 * 1000;
            xhr.setRequestHeader('Content-Type', reserved.content_type);
            for (const [key, value] of Object.entries(reserved.headers || {})) {
                // The browser supplies Content-Length from the File body.
                if (key.toLowerCase() !== 'content-length') xhr.setRequestHeader(key, value);
            }
            xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round(100 * e.loaded / e.total)); };
            xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? null : new Error('upload failed'));
            xhr.onerror = xhr.ontimeout = () => finish(new Error('upload failed'));
            xhr.onabort = () => finish(new DOMException('Canceled', 'AbortError'));
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) { finish(new DOMException('Canceled', 'AbortError')); return; }
            xhr.send(file);
        });
        return (await call('/social/uploads', { method: 'POST', signal, body: JSON.stringify({ action: 'complete', id: reserved.id }) })).upload;
    } catch (err) {
        // Keep the reservation until cleanup has deleted the bytes and the PUT expires.
        try { await call('/social/uploads', { method: 'DELETE', body: JSON.stringify({ id: reserved.id }) }); } catch { /* abandoned uploads expire after 24h */ }
        throw err;
    }
}
