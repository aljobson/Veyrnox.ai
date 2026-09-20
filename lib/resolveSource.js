/**
 * Turn a user's upload key into something a provider can fetch.
 *
 * Split from lib/uploadSource.js on purpose: that module is pure rules and
 * unit-testable without a network; this one does the two things that need
 * R2 — read the leading bytes back, and mint the short-lived URL the
 * provider will use.
 *
 * Gate 2 lives here. A declared Content-Type is only a claim until the
 * stored bytes are read, and nothing reaches a provider or a presigned GET
 * until they match.
 */

import { presignGetUrl } from '../packages/adapters/r2.js';
import { ownsUploadKey, typeForKey, checkSniffed, SNIFF_BYTES, ALLOWED_UPLOAD_TYPES } from './uploadSource.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

// The provider fetches the source immediately after submit, so the URL only
// has to outlive the submit call. CLAUDE.md caps any presigned URL at 15 min.
const SOURCE_URL_TTL_SECONDS = 900;
const SNIFF_TIMEOUT_MS = 10000;

/**
 * Verify an uploaded source belongs to this caller, is what it claimed to
 * be, and hand back the provider input for it.
 *
 * @returns {Promise<{ok:true, field:string, url:string, contentType:string}
 *                 |{ok:false, error:string}>}
 */
export async function resolveUploadedSource(authId, key, r2cfg) {
    // Ownership is in the key path, so this costs no round trip. A key for
    // another user reads exactly like a key that never existed.
    if (!ownsUploadKey(authId, key)) return { ok: false, error: 'source_not_found' };

    const declared = typeForKey(key);
    if (!declared) return { ok: false, error: 'source_not_found' };

    let signed;
    try {
        signed = await presignGetUrl(key, SOURCE_URL_TTL_SECONDS, r2cfg);
    } catch (err) {
        console.error('[source] presign failed:', err && err.message);
        return { ok: false, error: 'internal' };
    }

    // A ranged read: enough bytes to identify the container, and no more.
    // The same request proves the object exists without downloading it.
    let head;
    try {
        head = await fetchWithTimeout(signed.url, {
            headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` },
        }, SNIFF_TIMEOUT_MS);
    } catch (err) {
        console.error('[source] range read failed:', err && err.message);
        return { ok: false, error: 'source_unreadable' };
    }

    if (head.status === 404 || head.status === 403) return { ok: false, error: 'source_not_found' };
    // 206 for a served range; 200 if R2 ignored it and sent the whole object.
    if (head.status !== 206 && head.status !== 200) {
        console.error('[source] unexpected range status', head.status);
        return { ok: false, error: 'source_unreadable' };
    }

    // The declared size at signing time was only a claim: presignPutUrl signs
    // content-type, not Content-Length, so R2 will accept an object of any
    // size under that signature. The range response carries the real total in
    // `content-range: bytes 0-15/<total>`, which is the first point anyone has
    // seen it. copyUrlToR2 makes the same check on the way in.
    const range = head.headers.get('content-range') || '';
    const total = Number((/\/(\d+)\s*$/.exec(range) || [])[1]);
    const cap = ALLOWED_UPLOAD_TYPES[declared.contentType].maxBytes;
    if (Number.isFinite(total) && total > cap) {
        console.error('[source] stored object exceeds its type cap', key, total, '>', cap);
        return { ok: false, error: 'upload_too_large' };
    }
    if (head.status === 206 && !Number.isFinite(total)) {
        // A 206 with no parseable total means we cannot prove the size. Refuse
        // rather than hand an unbounded object to a provider.
        console.error('[source] range response carried no total', key, range);
        return { ok: false, error: 'source_unreadable' };
    }

    let bytes;
    try {
        bytes = new Uint8Array(await head.arrayBuffer());
    } catch (err) {
        console.error('[source] body read failed:', err && err.message);
        return { ok: false, error: 'source_unreadable' };
    }

    // Gate 2. A file whose bytes do not match what was declared at signing
    // time never becomes a provider input.
    const sniffed = checkSniffed(declared.contentType, bytes.subarray(0, SNIFF_BYTES));
    if (!sniffed.ok) {
        console.error('[source] content check refused', key, sniffed.error);
        return { ok: false, error: sniffed.error };
    }

    return { ok: true, field: declared.field, url: signed.url, contentType: declared.contentType };
}
