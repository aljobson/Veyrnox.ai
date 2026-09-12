/**
 * Cloudflare R2 client via S3 API — Worker-runtime.
 *
 * Uses AWS Signature v4 over plain `fetch` so we don't need the
 * `env.MEDIA` R2 binding (which requires wrangler.jsonc changes and
 * `getCloudflareContext()` at runtime — the latter is unproven for
 * middleware/route contexts). SigV4 is ~60 lines of Web Crypto here.
 *
 * Two operations:
 *   putObject(key, body, contentType, cfg)      — upload a fetched blob
 *   presignGetUrl(key, expiresSeconds, cfg)     — signed URL for the
 *                                                 client to download
 *                                                 directly, no proxy hop.
 *
 * Config from env at the call site:
 *   R2_ACCOUNT_ID          Cloudflare account id
 *   R2_ACCESS_KEY_ID       R2 access key
 *   R2_SECRET_ACCESS_KEY   R2 secret
 *   R2_BUCKET              bucket name (e.g. veyrnox-media)
 *
 * Endpoint: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
 * Region: 'auto' per R2 docs.
 */

const REGION = 'auto';
const SERVICE = 's3';

// Hosts fal serves generated assets from. Anything else is refused by
// copyUrlToR2 — the URL arrives in a provider payload, never trusted blindly.
const ALLOWED_SOURCE_SUFFIXES = ['.fal.media', '.fal.run', '.fal.ai'];
const ALLOWED_SOURCE_HOSTS = ['fal.media', 'fal.run', 'fal.ai'];
// ponytail: 100 MB cap, the Worker holds the body in memory. Stream to R2 multipart if outputs grow.
const COPY_MAX_BYTES = 100 * 1024 * 1024;

function isAllowedSourceHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    return ALLOWED_SOURCE_HOSTS.includes(h) || ALLOWED_SOURCE_SUFFIXES.some((s) => h.endsWith(s));
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
    return Boolean(cfg && cfg.accountId && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket);
}

/** @returns {{accountId, accessKeyId, secretAccessKey, bucket}} */
export function envConfig() {
    return {
        accountId: process.env.R2_ACCOUNT_ID,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        bucket: process.env.R2_BUCKET,
    };
}

function endpointOrigin(accountId) {
    return `https://${accountId}.r2.cloudflarestorage.com`;
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
    if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
        return { ok: false, error: 'R2 not configured' };
    }
    const bodyBytes = body instanceof Uint8Array
        ? body
        : body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : new Uint8Array(await new Response(body).arrayBuffer());

    const amzDate = iso8601BasicNow();
    const dateStamp = amzDate.slice(0, 8);
    const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
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

    const res = await fetch(`${endpointOrigin(cfg.accountId)}${canonicalUri}`, {
        method: 'PUT',
        headers: {
            'content-type': contentType,
            host,
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate,
            authorization,
        },
        body: bodyBytes,
    });
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
    if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
        return { ok: false, error: 'R2 not configured' };
    }
    const amzDate = iso8601BasicNow();
    const dateStamp = amzDate.slice(0, 8);
    const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
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

    const res = await fetch(`${endpointOrigin(cfg.accountId)}${canonicalUri}`, {
        method: 'DELETE',
        headers: {
            host,
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate,
            authorization,
        },
    });
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
 * Build a presigned GET URL for an R2 object. `expiresSeconds` is
 * clamped to [60, 900] — CLAUDE.md rule: presigned URL TTL <=15 min,
 * longer TTLs need an ADR. Defense in depth against future callers;
 * the API route already caps at 900.
 * Returns { url } or throws for config errors.
 */
export async function presignGetUrl(key, expiresSeconds, cfg) {
    if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
        throw new Error('R2 not configured');
    }
    const expires = Math.max(60, Math.min(900, expiresSeconds | 0));
    const amzDate = iso8601BasicNow();
    const dateStamp = amzDate.slice(0, 8);
    const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
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

    return { url: `${endpointOrigin(cfg.accountId)}${canonicalUri}?${sorted.toString()}`, expires };
}

/**
 * Convenience: fetch a URL and stream the bytes into R2. Used by the
 * fal webhook to copy a provider-hosted output into our bucket
 * before it expires.
 */
export async function copyUrlToR2(sourceUrl, r2Key, cfg, { timeoutMs = 30000, maxBytes = COPY_MAX_BYTES } = {}) {
    // Outbound fetch targets must be constants or provider CDNs (CLAUDE.md
    // OWASP #10). The URL comes from a provider payload, so pin the host.
    let parsed;
    try { parsed = new URL(sourceUrl); } catch { return { ok: false, error: 'source url invalid' }; }
    if (parsed.protocol !== 'https:' || !isAllowedSourceHost(parsed.hostname)) {
        console.error('R2 copy source host not allowed:', parsed.hostname);
        return { ok: false, error: 'source host not allowed' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let src;
        try {
            src = await fetch(parsed.toString(), { signal: controller.signal, redirect: 'error' });
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
        const put = await putObject(r2Key, bytes, contentType, cfg);
        if (!put.ok) return put;
        return { ok: true, r2Key: put.r2Key, size: put.size, mimeType: contentType };
    } finally {
        clearTimeout(timer);
    }
}
