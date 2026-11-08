import { createHash } from 'node:crypto';
import { presignGetUrl } from '../packages/adapters/r2.js';
import { admissionAvailable } from './uploadAdmission.js';
import { ownsUploadKey, typeForKey, checkSniffed } from './uploadSource.js';
import { fetchWithTimeout, streamWithTimeout } from './fetchWithTimeout.js';
import { probeSpeechSource, speechSourceSizeAllowed } from './speechSourceProbe.js';

/** Server-computed SHA256, never a client fingerprint or URL. Streams <=100 MiB. */
export async function resolveSpeechUpload(auth, key, cfg, {
    admission = admissionAvailable, sign = presignGetUrl, fetcher = fetchWithTimeout,
    stream = streamWithTimeout, probe = probeSpeechSource,
} = {}) {
    const bad = code => ({ ok: false, code });
    if (!ownsUploadKey(auth, key)) return bad('NOT_FOUND');
    if (!admission().ok) return bad('SOURCE_NOT_ADMITTED');
    const declared = typeForKey(key);
    if (!['video/mp4', 'video/quicktime'].includes(declared?.contentType)) return bad('SOURCE_UNSUPPORTED');
    const { url } = await sign(key, 900, cfg);
    // Signed GET range supplies HEAD metadata plus the actual magic bytes.
    const head = await fetcher(url, { redirect: 'error', headers: { Range: 'bytes=0-15' } }, 10000, 16);
    const size = Number(/^bytes 0-15\/(\d+)$/.exec(head.headers.get('content-range') || '')?.[1]);
    const etag = head.headers.get('etag');
    const asset = { ok: true, r2_key: key, size_bytes: size, mime_type: declared.contentType, etag };
    if (head.status !== 206 || !etag || head.headers.get('content-type') !== asset.mime_type
        || !speechSourceSizeAllowed(asset) || !checkSniffed(asset.mime_type, new Uint8Array(await head.arrayBuffer())).ok) return bad('SOURCE_UNSUPPORTED');
    const hash = createHash('sha256');
    const read = await stream(url, { redirect: 'error', headers: { 'If-Match': etag } }, 60000, size, chunk => { hash.update(chunk); });
    if (read.status !== 200 || read.bytes !== size) return bad('SOURCE_UNSUPPORTED');
    asset.sha256 = hash.digest('hex');
    const measured = await probe(asset, cfg);
    if (!measured || !speechSourceSizeAllowed(asset, measured.duration)) return bad('SOURCE_UNSUPPORTED');
    if (measured.duration > 60) return bad('SOURCE_TOO_LONG');
    return { ...asset, probe: measured };
}
