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
import { rpc } from '../packages/db/supabase-client.js';
import { ownsUploadKey, typeForKey, fieldForType, checkSniffed, imageDimensions, SNIFF_BYTES, DIMENSION_BYTES, ALLOWED_UPLOAD_TYPES } from './uploadSource.js';
import { fetchWithTimeout, streamWithTimeout } from './fetchWithTimeout.js';
import { wavSeconds, mp3FrameCounter, mp4Seconds } from './mediaLength.js';

// The provider fetches the source immediately after submit, so the URL only
// has to outlive the submit call. CLAUDE.md caps any presigned URL at 15 min.
const SOURCE_URL_TTL_SECONDS = 900;
const SNIFF_TIMEOUT_MS = 10000;

/**
 * Verify an uploaded source belongs to this caller, is what it claimed to
 * be, and hand back the provider input for it.
 *
 * @returns {Promise<{ok:true, field:string, url:string, contentType:string,
 *                   dimensions:{width:number,height:number}|null, seconds:number|null}
 *                 |{ok:false, error:string}>}
 */
export async function resolveUploadedSource(authId, key, r2cfg) {
    // Ownership is in the key path, so this costs no round trip. A key for
    // another user reads exactly like a key that never existed.
    if (!ownsUploadKey(authId, key)) return { ok: false, error: 'source_not_found' };

    const declared = typeForKey(key);
    if (!declared) return { ok: false, error: 'source_not_found' };
    return inspectStoredSource(key, declared, r2cfg);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A finished Library asset as a source, named by the id of the job that made
 * it (the studio's "From library"). get_user_asset checks the caller owns it,
 * as the Clip Editor does (lib/clipEditSources.js); its bytes then pass the
 * same Gate 2 as an upload. Images only, and only before the asset expires.
 *
 * @param {{asset?: (authId:string, jobId:string) => Promise<object>, now?: () => number}} [deps]
 */
export async function resolveAssetSource(authId, jobId, r2cfg, dbcfg, deps = {}) {
    if (typeof jobId !== 'string' || !UUID_RE.test(jobId)) return { ok: false, error: 'source_asset_invalid' };
    const lookup = deps.asset || ((a, j) => rpc('get_user_asset', { p_auth_id: a, p_job_id: j }, dbcfg));
    let asset;
    try {
        asset = await lookup(authId, jobId);
    } catch (err) {
        console.error('[source] asset lookup failed:', err && err.message);
        return { ok: false, error: 'internal' };
    }
    // Another user's asset reads exactly like one that does not exist.
    if (!asset || asset.ok !== true || asset.state !== 'STORED' || typeof asset.r2_key !== 'string') {
        return { ok: false, error: 'source_not_found' };
    }
    const expires = asset.asset_expires_at ? Date.parse(asset.asset_expires_at) : NaN;
    if (Number.isFinite(expires) && expires <= (deps.now ? deps.now() : Date.now())) return { ok: false, error: 'source_not_found' };
    const contentType = String(asset.mime_type || '');
    const field = ALLOWED_UPLOAD_TYPES[contentType] && contentType.startsWith('image/') ? fieldForType(contentType) : null;
    if (!field) return { ok: false, error: 'source_type_unsupported' };
    return inspectStoredSource(asset.r2_key, { contentType, field }, r2cfg);
}

/** Sign the stored object, read its head, and run Gate 2 on it. */
async function inspectStoredSource(key, declared, r2cfg) {
    let signed;
    try {
        signed = await presignGetUrl(key, SOURCE_URL_TTL_SECONDS, r2cfg);
    } catch (err) {
        console.error('[source] presign failed:', err && err.message);
        return { ok: false, error: 'internal' };
    }

    // A ranged read: enough bytes to identify the container (and, for an
    // image or audio, its pixel size or length), and no more. The same request
    // proves the object exists without downloading it.
    const readBytes = declared.contentType.startsWith('video/') ? SNIFF_BYTES : DIMENSION_BYTES;
    let head;
    try {
        head = await fetchWithTimeout(signed.url, {
            headers: { Range: `bytes=0-${readBytes - 1}` },
        }, SNIFF_TIMEOUT_MS, readBytes);
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

    const size = Number.isFinite(total) ? total : bytes.length;
    return {
        ok: true, field: declared.field, url: signed.url, contentType: declared.contentType,
        dimensions: declared.contentType.startsWith('image/') ? imageDimensions(bytes) : null,
        seconds: await lengthOf(declared.contentType, bytes, size, signed.url),
    };
}

/** Playing time in seconds, or null when the headers do not give it. */
async function lengthOf(contentType, bytes, size, url) {
    if (contentType === 'audio/wav') return wavSeconds(bytes, size);
    if (contentType !== 'audio/mpeg' && contentType !== 'video/mp4') return null;
    const readRange = async (start, end) => {
        const res = await fetchWithTimeout(url, { headers: { Range: `bytes=${start}-${end}` } }, SNIFF_TIMEOUT_MS, end - start + 1);
        if (res.status !== 206 && res.status !== 200) throw new Error(`range ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
    };
    try {
        if (contentType === 'audio/mpeg') return await mp3Length(bytes, size, url);
        return await mp4Seconds(readRange, size);
    } catch (err) {
        console.error('[source] length read failed:', err && err.message);
        return null;
    }
}

/**
 * An MP3's frames are counted across the whole object, but it is never held in
 * one piece: the first read (already in `bytes`) is fed to the counter, then
 * the rest is streamed chunk by chunk and dropped as it is counted. One
 * measurement holds at most one network chunk plus a frame-sized carry, not the
 * 20 MiB object, so the memory a request can demand does not grow with the file
 * or multiply across concurrent measurements (the per-user attempt limit and
 * the 20 MiB per-object cap still bound the rest).
 */
async function mp3Length(bytes, size, url) {
    if (bytes.length >= size) { const c = mp3FrameCounter(); c.push(bytes.subarray(0, size)); return c.end(); }
    const counter = mp3FrameCounter();
    counter.push(bytes);
    let delivered = bytes.length;
    const res = await streamWithTimeout(
        url,
        { headers: { Range: `bytes=${bytes.length}-${size - 1}` } },
        SNIFF_TIMEOUT_MS,
        size - bytes.length,
        (chunk) => { delivered += chunk.byteLength; return counter.push(chunk); },
    );
    // A 200 would restart at byte 0, not continue the file; a short body cannot be measured either way.
    if (res.status !== 206 || delivered !== size) return null;
    return counter.end();
}
