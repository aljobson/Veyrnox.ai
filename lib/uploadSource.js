/**
 * User-supplied source files for Transform generations (face filters).
 *
 * Pure logic only — no network, no Next, no env — so every rule here is
 * unit-testable and the route stays a thin shell around it.
 *
 * Two gates, deliberately separate:
 *
 *   1. `checkDeclared()` runs before a presigned PUT is issued. It judges
 *      only what the client *claims*: a media type and a byte count.
 *   2. `sniffType()` runs after the bytes are in R2 and before they are
 *      handed to a provider. It judges what the file *is*.
 *
 * A declared Content-Type is a claim, not evidence. The signature on the
 * presigned PUT pins the type R2 will accept (see r2.js#presignPutUrl), so
 * a client cannot upload under a type it did not ask for — but it can still
 * ask for `image/png` and send an HTML file with a .png name. Gate 2 is what
 * stops that reaching a provider or a presigned GET.
 */

// Accepted upload types and their per-type ceilings. Anything absent here is
// refused: this is an allowlist, never a blocklist.
// ponytail: four types covers every launch filter (PRD A1-A6). Add one when a
// verified endpoint needs it, not before.
export const ALLOWED_UPLOAD_TYPES = {
    'image/jpeg': { maxBytes: 20 * 1024 * 1024, extension: 'jpg' },
    'image/png': { maxBytes: 20 * 1024 * 1024, extension: 'png' },
    'image/webp': { maxBytes: 20 * 1024 * 1024, extension: 'webp' },
    'video/mp4': { maxBytes: 100 * 1024 * 1024, extension: 'mp4' },
};

export const UPLOAD_PREFIX = 'uploads';

// Presigned upload URLs live 15 minutes, the CLAUDE.md ceiling for any
// presigned URL. Long enough for a slow mobile upload of the video cap.
export const UPLOAD_URL_TTL_SECONDS = 900;

// The read used by sniffType. 16 bytes covers every signature below; the
// caller fetches a ranged read rather than the whole object.
export const SNIFF_BYTES = 16;
// Enough of an image to reach its size: PNG and WebP carry it in the first
// 30 bytes, JPEG after its metadata segments, which are at most 64 KB each.
export const DIMENSION_BYTES = 128 * 1024;

// The auth id is the Supabase `sub` claim, which is a UUID. It becomes a path
// segment, so it is validated as one rather than trusted — a header the
// middleware sets is still a string reaching a storage key.
const AUTH_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Keys this module mints. Matched exactly so a key from a request body can be
// checked against its claimed owner without parsing ambiguity. The extension
// alternation is derived from the allowlist rather than written as a generic
// `[a-z0-9]{3,4}` — that pattern also matches `.exe`, and a key is an ownership
// claim, so it may only ever describe a file this module could have created.
const UPLOAD_EXTENSIONS = [...new Set(Object.values(ALLOWED_UPLOAD_TYPES).map((r) => r.extension))];
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UPLOAD_KEY_RE = new RegExp(
    `^${UPLOAD_PREFIX}/(${UUID_PATTERN})/(${UUID_PATTERN})\\.(${UPLOAD_EXTENSIONS.join('|')})$`,
    'i',
);

/**
 * Judge a claimed upload before signing anything.
 * @returns {{ok:true, contentType:string, maxBytes:number}|{ok:false, error:string}}
 */
export function checkDeclared(contentType, sizeBytes) {
    const type = typeof contentType === 'string' ? contentType.trim().toLowerCase() : '';
    const rule = Object.prototype.hasOwnProperty.call(ALLOWED_UPLOAD_TYPES, type)
        ? ALLOWED_UPLOAD_TYPES[type]
        : undefined;
    if (!rule) return { ok: false, error: 'upload_type_not_allowed' };

    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) return { ok: false, error: 'upload_size_required' };
    if (sizeBytes > rule.maxBytes) return { ok: false, error: 'upload_too_large' };

    return { ok: true, contentType: type, maxBytes: rule.maxBytes };
}

/**
 * Derive the R2 key for an upload. The caller supplies the random id so the
 * function stays pure; the route passes crypto.randomUUID().
 *
 * The key is built entirely from values the server controls. A filename from
 * the client never appears in it — CLAUDE.md: R2 keys use random UUIDs, never
 * user-controlled paths.
 * @returns {{ok:true, key:string}|{ok:false, error:string}}
 */
export function uploadKeyFor(authId, contentType, uuid) {
    if (typeof authId !== 'string' || !AUTH_ID_RE.test(authId)) return { ok: false, error: 'auth_id_invalid' };
    const rule = ALLOWED_UPLOAD_TYPES[String(contentType || '').trim().toLowerCase()];
    if (!rule) return { ok: false, error: 'upload_type_not_allowed' };
    if (typeof uuid !== 'string' || !AUTH_ID_RE.test(uuid)) return { ok: false, error: 'upload_id_invalid' };
    return { ok: true, key: `${UPLOAD_PREFIX}/${authId.toLowerCase()}/${uuid.toLowerCase()}.${rule.extension}` };
}

/**
 * True when `key` is an upload key this module could have minted for
 * `authId`. Used before minting a presigned GET on a source and before
 * submitting it to a provider: the owner segment is in the path, so
 * ownership is checkable without a database round trip.
 *
 * Rejects anything that is not an exact match — no prefix test, which
 * `uploads/<victim>/..%2f` style input would otherwise slip past.
 */
export function ownsUploadKey(authId, key) {
    if (typeof authId !== 'string' || !AUTH_ID_RE.test(authId)) return false;
    if (typeof key !== 'string') return false;
    const m = UPLOAD_KEY_RE.exec(key);
    if (!m) return false;
    return m[1].toLowerCase() === authId.toLowerCase();
}

/**
 * Identify a file from its leading bytes. Returns the media type, or null
 * when the bytes match nothing we accept.
 *
 * Signatures are checked against the allowlist only. An unrecognised file is
 * refused rather than guessed at — "probably fine" is how an HTML document
 * ends up served from our own origin under an image content type.
 */
export function sniffType(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (b.length < 12) return null;

    // JPEG: FF D8 FF
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';

    // PNG: 89 'P' 'N' 'G' CR LF 1A LF
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
        && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';

    // WebP: 'RIFF' .... 'WEBP'
    if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'image/webp';

    // MP4 and friends: a box length, then 'ftyp'. The brand at offset 8 varies
    // (isom, mp42, avc1, ...); the box type is what identifies the container.
    if (ascii(b, 4, 'ftyp')) return 'video/mp4';

    return null;
}

/**
 * Pixel size from an image's leading bytes, or null when it is not there.
 * Read from the file header, never trusted from the client.
 * @returns {{width:number, height:number}|null}
 */
export function imageDimensions(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const type = sniffType(b);
    const u16 = (i) => (b[i] << 8) | b[i + 1];
    const u32 = (i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
    const le16 = (i) => b[i] | (b[i + 1] << 8);
    const le24 = (i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
    let out = null;
    if (type === 'image/png' && b.length >= 24 && ascii(b, 12, 'IHDR')) {
        out = { width: u32(16), height: u32(20) };
    } else if (type === 'image/webp' && b.length >= 30) {
        if (ascii(b, 12, 'VP8X')) out = { width: le24(24) + 1, height: le24(27) + 1 };
        else if (ascii(b, 12, 'VP8L')) {
            const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
            out = { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 };
        } else if (ascii(b, 12, 'VP8 ')) out = { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    } else if (type === 'image/jpeg') {
        // Walk the marker segments to the first start-of-frame.
        let i = 2;
        while (i + 9 < b.length && b[i] === 0xff) {
            const marker = b[i + 1];
            if (marker === 0xff) { i += 1; continue; }
            const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
            if (isSof) { out = { width: u16(i + 7), height: u16(i + 5) }; break; }
            i += 2 + u16(i + 2);
        }
    }
    return out && out.width > 0 && out.height > 0 ? out : null;
}

/**
 * Gate 2: do the bytes match what was declared?
 * @returns {{ok:true}|{ok:false, error:string}}
 */
export function checkSniffed(declaredType, bytes) {
    const declared = String(declaredType || '').trim().toLowerCase();
    const actual = sniffType(bytes);
    if (!actual) return { ok: false, error: 'upload_unreadable' };
    if (actual !== declared) return { ok: false, error: 'upload_type_mismatch' };
    return { ok: true };
}

/**
 * True when `key` is shaped like a key this module mints, for any owner.
 * The sweep uses this: it must never delete an object it did not create,
 * and it has no auth id to check against.
 */
export function isUploadKey(key) {
    return typeof key === 'string' && UPLOAD_KEY_RE.test(key);
}

// How long an uploaded source may sit in R2. A source is consumed at submit,
// seconds after upload, so this is generous — it exists to cover an upload
// the user abandoned. Deliberately far shorter than the ADR-0008 retention
// for generated assets: an upload is somebody else's content, we never chose
// to hold it, and every hour it stays is exposure (ADR-0025 section 8.1).
export const UPLOAD_MAX_AGE_HOURS = 24;

/**
 * The media type an upload key describes, derived from the extension this
 * module put there. Returns null for anything this module did not mint.
 *
 * The key is the server's own record of what was declared at signing time,
 * which is what gate 2 checks the bytes against.
 * @returns {{contentType:string, field:'image_url'|'video_url'}|null}
 */
export function typeForKey(key) {
    const m = UPLOAD_KEY_RE.exec(typeof key === 'string' ? key : '');
    if (!m) return null;
    const ext = m[3].toLowerCase();
    for (const [contentType, rule] of Object.entries(ALLOWED_UPLOAD_TYPES)) {
        if (rule.extension !== ext) continue;
        return { contentType, field: contentType.startsWith('video/') ? 'video_url' : 'image_url' };
    }
    return null;
}

function ascii(bytes, offset, text) {
    for (let i = 0; i < text.length; i += 1) {
        if (bytes[offset + i] !== text.charCodeAt(i)) return false;
    }
    return true;
}
