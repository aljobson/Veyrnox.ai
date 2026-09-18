/**
 * Cloudflare R2 client via S3 API — Worker-runtime.
 *
 * Uses AWS Signature v4 over plain `fetch` so we don't need the
 * `env.MEDIA` R2 binding (which requires wrangler.jsonc changes and
 * `getCloudflareContext()` at runtime — the latter is unproven for
 * middleware/route contexts). SigV4 is ~60 lines of Web Crypto here.
 *
 * Three operations:
 *   putObject(key, body, contentType, cfg)      — upload a fetched blob
 *   presignGetUrl(key, expiresSeconds, cfg)     — signed URL for the
 *                                                 client to download
 *                                                 directly, no proxy hop.
 *   presignPutUrl(key, contentType, expiresSeconds, cfg)
 *                                               — signed URL for the client
 *                                                 to upload directly, so a
 *                                                 user's source file never
 *                                                 passes through the Worker.
 *
 * Config from env at the call site:
 *   R2_ACCOUNT_ID          Cloudflare account id
 *   R2_ACCESS_KEY_ID       R2 access key
 *   R2_SECRET_ACCESS_KEY   R2 secret
 *   R2_BUCKET              bucket name (e.g. veyrnox-media)
 *   R2_JURISDICTION        optional; 'eu' for a bucket created with an EU
 *                          jurisdictional restriction (ADR-0021). A bucket in
 *                          a jurisdiction is only reachable through that
 *                          jurisdiction's endpoint, so an unknown value is
 *                          treated as not configured rather than guessed.
 *
 * Endpoint: https://<account>[.<jurisdiction>].r2.cloudflarestorage.com/<bucket>/<key>
 * Region: 'auto' per R2 docs.
 */

const REGION = 'auto';
const SERVICE = 's3';

// Hosts each provider serves generated assets from. Anything else is refused
// by copyUrlToR2 — the URL arrives in a provider payload, never trusted
// blindly, and each provider's copy may only fetch from that provider's CDN.
// ponytail: kie's list is from its docs examples (tempfile/templateb
// .aiquickdraw.com); confirm against a live output before activating a kie row.
const SOURCE_HOSTS = {
    fal: { hosts: ['fal.media', 'fal.run', 'fal.ai'], suffixes: ['.fal.media', '.fal.run', '.fal.ai'] },
    kie: { hosts: [], suffixes: ['.aiquickdraw.com'] },
    // Content endpoint needs our API key, so the exact API host only.
    openrouter: { hosts: ['openrouter.ai'], suffixes: [] },
};
// Providers whose output download carries our API key. The key may only go to
// a host in that provider's list above, which for these is its own API host.
const AUTHENTICATED_SOURCES = new Set(['openrouter']);
// ponytail: 100 MB cap, the Worker holds the body in memory. Stream to R2 multipart if outputs grow.
const COPY_MAX_BYTES = 100 * 1024 * 1024;
// Deadline for the S3 round trips. Without one, an R2 edge that accepts the
// connection and stalls hangs the whole webhook delivery, the provider times
// out, and its retry starts the copy again — a stall becomes a retry storm.
// Generous because a PUT carries up to COPY_MAX_BYTES.
const S3_TIMEOUT_MS = 30000;

/** fetch with a deadline. Kept local: this module intentionally has no imports. */
function fetchDeadline(input, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function isAllowedSourceHost(hostname, provider) {
    const allow = Object.prototype.hasOwnProperty.call(SOURCE_HOSTS, provider) ? SOURCE_HOSTS[provider] : null;
    if (!allow) return false;
    const h = String(hostname || '').toLowerCase();
    return allow.hosts.includes(h) || allow.suffixes.some((s) => h.endsWith(s));
}

/** Read a ReadableStream into bytes; returns null once `maxBytes` is exceeded. */
async function readCapped(stream, maxBytes) {
    if (!stream) return new Uint8Array(0);
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            return null;
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return out;
}

/** RFC 3986 percent-encoding: encodeURIComponent leaves !'()* unencoded, SigV4 does not. */
function rfc3986(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * True when every credential putObject needs is present. Callers that
 * mutate state before uploading should check this first and refuse the
 * request, rather than discovering a missing secret halfway through.
 */
export function isConfigured(cfg) {
    return Boolean(cfg && cfg.accountId && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket && jurisdictionOk(cfg));
}

const JURISDICTIONS = new Set(['eu']);

function jurisdictionOk(cfg) {
    return !cfg.jurisdiction || JURISDICTIONS.has(cfg.jurisdiction);
}

/** @returns {{accountId, accessKeyId, secretAccessKey, bucket, jurisdiction}} */
export function envConfig() {
    return {
        accountId: process.env.R2_ACCOUNT_ID,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        bucket: process.env.R2_BUCKET,
        jurisdiction: process.env.R2_JURISDICTION || undefined,
    };
}

function endpointHost(cfg) {
    return cfg.jurisdiction
        ? `${cfg.accountId}.${cfg.jurisdiction}.r2.cloudflarestorage.com`
        : `${cfg.accountId}.r2.cloudflarestorage.com`;
}

async function sha256Hex(buf) {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256(key, data) {
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        typeof key === 'string' ? new TextEncoder().encode(key) : key,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
    return new Uint8Array(sig);
}

function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function iso8601BasicNow() {
    // 20260911T204530Z (compact ISO — SigV4 requires this format)
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

async function signingKey(secret, dateStamp) {
    const kDate = await hmacSha256(`AWS4${secret}`, dateStamp);
    const kRegion = await hmacSha256(kDate, REGION);
    const kService = await hmacSha256(kRegion, SERVICE);
    const kSigning = await hmacSha256(kService, 'aws4_request');
    return kSigning;
}

/**
 * PUT an object to R2. Body must be a Uint8Array / ArrayBuffer / Blob.
 * Returns { ok, status, r2Key, size } or { ok:false, error }.
 */
export async function putObject(key, body, contentType, cfg) {
    if (!isConfigured(cfg)) {
        return { ok: false, error: 'R2 not configured' };
    }
    const bodyBytes = body instanceof Uint8Array
        ? body
        : body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : new Uint8Array(await new Response(body).arrayBuffer());

    const amzDate = iso8601BasicNow();
    const dateStamp = amzDate.slice(0, 8);
    const host = endpointHost(cfg);
    const canonicalUri = `/${cfg.bucket}/${key.split('/').map(rfc3986).join('/')}`;

    const payloadHash = await sha256Hex(bodyBytes);
    const canonicalHeaders =
        `content-type:${contentType}\n` +
        `host:${host}\n` +
        `x-amz-content-sha256:${payloadHash}\n` +
        `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest =
        `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
    const stringToSign =
        `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(new TextEncoder().encode(canonicalRequest))}`;
    const kSigning = await signingKey(cfg.secretAccessKey, dateStamp);
    const signature = bytesToHex(await hmacSha256(kSigning, stringToSign));
    const authorization =
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    let res;
    try {
        res = await fetchDeadline(`https://${host}${canonicalUri}`, {
            method: 'PUT',
            headers: {
                'content-type': contentType,
                host,
                'x-amz-content-sha256': payloadHash,
                'x-amz-date': amzDate,
                authorization,
            },
            body: bodyBytes,
        }, S3_TIMEOUT_MS);
    } catch (err) {
        console.error('R2 PUT failed:', err && err.name);
        return { ok: false, error: `R2 PUT transport: ${err && err.name}` };
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('R2 PUT non-ok:', res.status, text.slice(0, 200));
        return { ok: false, error: `R2 PUT ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, status: res.status, r2Key: key, size: bodyBytes.length };
}

/**
 * Delete an R2 object. SigV4-signed DELETE against the account's R2 S3 API.
 * Body is empty; payload hash is the SHA-256 of the empty string, per spec.
 * Returns { ok: true, status } on success, { ok: false, error } on failure.
 */
export async function deleteObject(key, cfg) {
    if (!isConfigured(cfg)) {
        return { ok: false, error: 'R2 not configured' };
    }
    const amzDate = iso8601BasicNow();
    const dateStamp = amzDate.slice(0, 8);
    const host = endpointHost(cfg);
    const canonicalUri = `/${cfg.bucket}/${key.split('/').map(rfc3986).join('/')}`;

    const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const canonicalHeaders =
        `host:${host}\n` +
        `x-amz-content-sha256:${payloadHash}\n` +
        `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest =
        `DELETE\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
    const stringToSign =
        `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(new TextEncoder().encode(canonicalRequest))}`;
    const kSigning = await signingKey(cfg.secretAccessKey, dateStamp);
    const signature = bytesToHex(await hmacSha256(kSigning, stringToSign));
    const authorization =
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    let res;
    try {
        res = await fetchDeadline(`https://${host}${canonicalUri}`, {
            method: 'DELETE',
            headers: {
                host,
                'x-amz-content-sha256': payloadHash,
                'x-amz-date': amzDate,
                authorization,
            },
        }, S3_TIMEOUT_MS);
    } catch (err) {
        console.error('R2 DELETE failed:', err && err.name);
        return { ok: false, error: `R2 DELETE transport: ${err && err.name}` };
    }
    // R2 returns 204 on delete of an existing object, 204 also when the
    // object is already gone. Treat both as success — idempotent by design.
    if (res.status !== 204 && !res.ok) {
        const text = await res.text().catch(() => '');
        console.error('R2 DELETE non-ok:', res.status, text.slice(0, 200));
        return { ok: false, error: `R2 DELETE ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, status: res.status };
}

/**
 * List objects under a prefix (S3 ListObjectsV2). Used by the upload sweep,
 * which is the only caller that needs to see objects it has no row for:
 * generated assets are tracked in `assets`, but a user's uploaded source is
 * a bare R2 object under `uploads/{auth_id}/{uuid}`.
 *
 * Returns at most `maxKeys` entries plus a continuation token, so a caller
 * can bound the work it does in one scheduled run rather than walking a
 * bucket of unknown size.
 *
 * @returns {Promise<{ok:true, objects:{key:string,lastModified:Date,size:number}[], nextToken:string|null}
 *                 |{ok:false, error:string}>}
 */
export async function listObjects(prefix, cfg, { maxKeys = 200, continuationToken } = {}) {
    if (!isConfigured(cfg)) return { ok: false, error: 'R2 not configured' };

    const amzDate = iso8601BasicNow();
    const dateStamp = amzDate.slice(0, 8);
    const host = endpointHost(cfg);
    const canonicalUri = `/${cfg.bucket}`;

    // SigV4 needs the query sorted by key, each part RFC3986-encoded.
    const params = [
        ['list-type', '2'],
        ['max-keys', String(Math.max(1, Math.min(1000, maxKeys | 0)))],
        ['prefix', String(prefix || '')],
    ];
    if (continuationToken) params.push(['continuation-token', continuationToken]);
    params.sort(([a], [b]) => a.localeCompare(b));
    const canonicalQuery = params.map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).join('&');

    // GET with no body: the payload hash is the SHA-256 of the empty string.
    const payloadHash = await sha256Hex(new Uint8Array(0));
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest =
        `GET\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
    const stringToSign =
        `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(new TextEncoder().encode(canonicalRequest))}`;
    const kSigning = await signingKey(cfg.secretAccessKey, dateStamp);
    const signature = bytesToHex(await hmacSha256(kSigning, stringToSign));
    const authorization =
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    let res;
    try {
        res = await fetchDeadline(`https://${host}${canonicalUri}?${canonicalQuery}`, {
            method: 'GET',
            headers: { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, authorization },
        }, S3_TIMEOUT_MS);
    } catch (err) {
        console.error('R2 LIST failed:', err && err.name);
        return { ok: false, error: `R2 LIST transport: ${err && err.name}` };
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('R2 LIST non-ok:', res.status, text.slice(0, 200));
        return { ok: false, error: `R2 LIST ${res.status}` };
    }

    // ListObjectsV2 answers XML. Pulling three fields out with a regex beats
    // shipping a parser for a document this shape — and a key that does not
    // match the upload-key pattern is refused by the sweep anyway.
    const xml = await res.text();
    const objects = [];
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const body = m[1];
        const key = (/<Key>([\s\S]*?)<\/Key>/.exec(body) || [])[1];
        const modified = (/<LastModified>([\s\S]*?)<\/LastModified>/.exec(body) || [])[1];
        const size = (/<Size>(\d+)<\/Size>/.exec(body) || [])[1];
        if (!key || !modified) continue;
        const lastModified = new Date(modified);
        if (Number.isNaN(lastModified.getTime())) continue;
        objects.push({ key: decodeXmlText(key), lastModified, size: Number(size || 0) });
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const nextToken = truncated
        ? (/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml) || [])[1] || null
        : null;

    return { ok: true, objects, nextToken };
}

/** The five XML entities S3 escapes in a key. */
function decodeXmlText(s) {
    return s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]);
}

/**
 * Build a presigned GET URL for an R2 object. `expiresSeconds` is
 * clamped to [60, 900] — CLAUDE.md rule: presigned URL TTL <=15 min,
 * longer TTLs need an ADR. Defense in depth against future callers;
 * the API route already caps at 900.
 * Returns { url } or throws for config errors.
 */
export async function presignGetUrl(key, expiresSeconds, cfg) {
    if (!isConfigured(cfg)) {
        throw new Error('R2 not configured');
    }
    const expires = Math.max(60, Math.min(900, expiresSeconds | 0));
    const amzDate = iso8601BasicNow();
    const dateStamp = amzDate.slice(0, 8);
    const host = endpointHost(cfg);
    const canonicalUri = `/${cfg.bucket}/${key.split('/').map(rfc3986).join('/')}`;
    const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

    const params = new URLSearchParams({
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${cfg.accessKeyId}/${credentialScope}`,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': String(expires),
        'X-Amz-SignedHeaders': 'host',
    });
    // Params sorted lexicographically per SigV4.
    const sorted = new URLSearchParams();
    for (const [k, v] of [...params.entries()].sort(([a], [b]) => a.localeCompare(b))) sorted.append(k, v);
    const canonicalQuery = sorted.toString();

    const canonicalRequest = `GET\n${canonicalUri}\n${canonicalQuery}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
    const stringToSign =
        `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(new TextEncoder().encode(canonicalRequest))}`;
    const kSigning = await signingKey(cfg.secretAccessKey, dateStamp);
    const signature = bytesToHex(await hmacSha256(kSigning, stringToSign));
    sorted.append('X-Amz-Signature', signature);

    return { url: `https://${host}${canonicalUri}?${sorted.toString()}`, expires };
}

/**
 * Build a presigned PUT URL so a browser can upload straight to R2 without
 * the bytes passing through the Worker. `expiresSeconds` is clamped to
 * [60, 900] like presignGetUrl — CLAUDE.md caps presigned TTLs at 15 min.
 *
 * `contentType` is a *signed* header, not a hint: the client must send
 * exactly this Content-Type or R2 rejects the PUT. That is what stops a
 * caller from requesting a signature for `image/png` and then uploading
 * something else under it.
 *
 * The caller owns the key. It must never be derived from client input —
 * R2 keys are random UUIDs under a `user_id` prefix (CLAUDE.md).
 * Returns { url, expires, contentType } or throws for config errors.
 */
export async function presignPutUrl(key, contentType, expiresSeconds, cfg) {
    if (!isConfigured(cfg)) {
        throw new Error('R2 not configured');
    }
    // SigV4 canonicalises a header value by trimming and, for the name,
    // lowercasing. A media type is case-insensitive, so lowercase the whole
    // value: the client can then send either case and still match.
    const ct = String(contentType || '').trim().toLowerCase();
    if (!ct) throw new Error('contentType required');

    const expires = Math.max(60, Math.min(900, expiresSeconds | 0));
    const amzDate = iso8601BasicNow();
    const dateStamp = amzDate.slice(0, 8);
    const host = endpointHost(cfg);
    const canonicalUri = `/${cfg.bucket}/${key.split('/').map(rfc3986).join('/')}`;
    const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

    const params = new URLSearchParams({
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${cfg.accessKeyId}/${credentialScope}`,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': String(expires),
        'X-Amz-SignedHeaders': 'content-type;host',
    });
    // Params sorted lexicographically per SigV4.
    const sorted = new URLSearchParams();
    for (const [k, v] of [...params.entries()].sort(([a], [b]) => a.localeCompare(b))) sorted.append(k, v);
    const canonicalQuery = sorted.toString();

    // Canonical headers are sorted by lowercased name: content-type, host.
    const canonicalRequest =
        `PUT\n${canonicalUri}\n${canonicalQuery}\ncontent-type:${ct}\nhost:${host}\n\ncontent-type;host\nUNSIGNED-PAYLOAD`;
    const stringToSign =
        `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(new TextEncoder().encode(canonicalRequest))}`;
    const kSigning = await signingKey(cfg.secretAccessKey, dateStamp);
    const signature = bytesToHex(await hmacSha256(kSigning, stringToSign));
    sorted.append('X-Amz-Signature', signature);

    return { url: `https://${host}${canonicalUri}?${sorted.toString()}`, expires, contentType: ct };
}

/**
 * Convenience: fetch a URL and stream the bytes into R2. Used by the
 * provider webhooks to copy a provider-hosted output into our bucket
 * before it expires. `provider` selects that provider's CDN allowlist;
 * it defaults to fal so the existing fal webhook is unchanged.
 */
export async function copyUrlToR2(sourceUrl, r2Key, cfg, { timeoutMs = 30000, maxBytes = COPY_MAX_BYTES, provider = 'fal', authorization } = {}) {
    // Outbound fetch targets must be constants or provider CDNs (CLAUDE.md
    // OWASP #10). The URL comes from a provider payload, so pin the host.
    let parsed;
    try { parsed = new URL(sourceUrl); } catch { return { ok: false, error: 'source url invalid' }; }
    if (parsed.protocol !== 'https:' || !isAllowedSourceHost(parsed.hostname, provider)) {
        console.error('R2 copy source host not allowed:', parsed.hostname);
        return { ok: false, error: 'source host not allowed' };
    }
    if (authorization && !AUTHENTICATED_SOURCES.has(provider)) return { ok: false, error: 'source auth not allowed' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let src;
        try {
            // 'manual', not 'error': the Workers runtime rejects redirect: 'error'
            // ("won't be implemented since it does not make sense at the edge"),
            // which failed every copy. 'manual' still never follows a redirect —
            // a 3xx comes back as a non-ok response and is refused below, so a
            // redirect cannot walk the fetch off the allowlisted fal CDN host.
            src = await fetch(parsed.toString(), {
                signal: controller.signal,
                redirect: 'manual',
                headers: authorization ? { Authorization: authorization } : undefined,
            });
        } catch (err) {
            const msg = err && err.message;
            console.error('R2 copy source fetch failed:', msg);
            return { ok: false, error: `fetch source: ${msg}` };
        }
        if (!src.ok) {
            console.error('R2 copy source non-ok:', src.status);
            return { ok: false, error: `source ${src.status}` };
        }
        const declared = Number(src.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxBytes) {
            return { ok: false, error: 'source too large' };
        }
        const contentType = src.headers.get('content-type') || 'application/octet-stream';
        // Body read is kept inside the timeout window so a hung stream still aborts.
        let bytes;
        try {
            bytes = await readCapped(src.body, maxBytes);
        } catch (err) {
            const msg = err && err.message;
            console.error('R2 copy source body read failed:', msg);
            return { ok: false, error: `read source: ${msg}` };
        }
        if (!bytes) return { ok: false, error: 'source too large' };
        // putObject carries its own S3_TIMEOUT_MS deadline; this function's
        // controller only ever covered the source fetch and body read.
        const put = await putObject(r2Key, bytes, contentType, cfg);
        if (!put.ok) return put;
        return { ok: true, r2Key: put.r2Key, size: put.size, mimeType: contentType };
    } finally {
        clearTimeout(timer);
    }
}
