// Browser timeline editor, slice 1 (ADR-0080): the user's own generations as editor sources. Uses the same two gateway calls as the
// Library (GET /jobs and GET /jobs/:id/asset); the caller passes `fetcher` (gatewayFetch) so this stays testable without a browser.
// A signed link lasts at most 15 minutes, so a link is fetched when a file is ADDED, never stored.
import { MEDIA_LIMITS } from './editorMedia.mjs';

const kindOf = mime => (mime?.startsWith('video/') ? 'video' : mime?.startsWith('audio/') ? 'audio' : null);

/** The account's generated videos and sounds, newest first: [{ jobId, label, kind }]. */
export async function listLibraryMedia(fetcher, { limit = 30, concurrency = 6 } = {}) {
    const page = await fetcher(`/jobs?limit=${limit}`);
    const jobs = (Array.isArray(page?.jobs) ? page.jobs : []).filter(j => j && j.has_asset && typeof j.job_id === 'string');
    const found = new Array(jobs.length).fill(null);
    let next = 0;
    async function worker() {
        while (next < jobs.length) {
            const i = next++;
            try {
                const asset = await fetcher(`/jobs/${encodeURIComponent(jobs[i].job_id)}/asset`);
                const kind = kindOf(asset?.mime_type);
                if (kind) found[i] = { jobId: jobs[i].job_id, label: String(jobs[i].label || jobs[i].model_id || 'Generation').slice(0, 80), kind };
            } catch { /* expired or removed: simply not offered */ }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
    return found.filter(Boolean);
}

/** Fetch one generation's bytes. `fetchBytes` is `fetch`; the link is requested now and used straight away. */
export async function loadLibraryBlob(fetcher, jobId, fetchBytes = fetch) {
    const asset = await fetcher(`/jobs/${encodeURIComponent(jobId)}/asset`);
    const kind = kindOf(asset?.mime_type);
    if (!kind || typeof asset.url !== 'string' || !asset.url.startsWith('https://')) throw new Error('That file is not available.');
    const res = await fetchBytes(asset.url, { credentials: 'omit' });
    if (!res.ok) throw new Error('Could not load that file. Try again.');
    const cap = kind === 'video' ? MEDIA_LIMITS.videoBytes : MEDIA_LIMITS.audioBytes;
    const declared = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > cap) throw new Error('That file is too large for the editor.');
    const blob = await res.blob();
    if (blob.size > cap) throw new Error('That file is too large for the editor.');
    return { blob, kind };
}
