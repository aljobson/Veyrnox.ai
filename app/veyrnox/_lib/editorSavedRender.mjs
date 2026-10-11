import { EDITOR_RENDER_MAX_BYTES } from './editorDelivery.mjs';
const HOSTS = new Set(['fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com', 'fb18d9f7052afbea5a5e0eae69948af2.eu.r2.cloudflarestorage.com']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Read a fresh owned link, stream within the saved byte count and verify its hash. */
export async function loadSavedRender(call, row, { signal, fetchBytes = fetch } = {}) {
    if (!UUID.test(row?.id || '')) throw new Error('The saved video ID is invalid.');
    const asset = await call(`/library/editor-renders/${row.id}/asset`);
    let url;
    try { url = new URL(asset.url); } catch { throw new Error('The saved video link is invalid.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !HOSTS.has(url.hostname)
        || asset.mime_type !== 'video/mp4' || !Number.isSafeInteger(asset.size_bytes) || asset.size_bytes < 1 || asset.size_bytes > EDITOR_RENDER_MAX_BYTES
        || !/^[a-f0-9]{64}$/.test(asset.sha256 || '')) throw new Error('The saved video metadata is invalid.');
    signal?.throwIfAborted();
    const response = await fetchBytes(url.href, { credentials: 'omit', redirect: 'error', signal });
    if (!response.ok || !response.body) throw new Error('The saved video could not be downloaded.');
    const reader = response.body.getReader(), bytes = new Uint8Array(asset.size_bytes); let offset = 0;
    try {
        for (;;) { const { value, done } = await reader.read(); if (done) break; if (offset + value.length > bytes.length) throw new Error('The saved video is larger than expected.'); bytes.set(value, offset); offset += value.length; }
        if (offset !== bytes.length) throw new Error('The saved video is incomplete.');
    } catch (e) { await reader.cancel().catch(() => {}); throw e; } finally { reader.releaseLock(); }
    signal?.throwIfAborted();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== asset.sha256) throw new Error('The saved video did not match its verified bytes.');
    return new File([bytes], String(row.label || 'Saved edit.mp4').slice(0, 180), { type: 'video/mp4' });
}
