/**
 * Copy a provider-hosted output into our R2 bucket (split out of r2.js to
 * keep that file under the 500-line limit). The SigV4 client stays in r2.js;
 * this module owns the part that fetches from a URL a provider handed us,
 * which is the SSRF-sensitive half: host allowlist, no redirects, size cap.
 */

import { putObject, sha256Hex } from './r2.js';

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
        // Hash the provider's bytes before they are stored, so the digest
        // describes what the user receives (ADR-0025 option E). The delivery
        // path is byte-preserving, so this value stays true of the served
        // file — which is what lets a holder of a file check it against our
        // record instead of taking our word for it.
        const sha256 = await sha256Hex(bytes);
        // putObject carries its own S3_TIMEOUT_MS deadline; this function's
        // controller only ever covered the source fetch and body read.
        const put = await putObject(r2Key, bytes, contentType, cfg);
        if (!put.ok) return put;
        return { ok: true, r2Key: put.r2Key, size: put.size, mimeType: contentType, sha256 };
    } finally {
        clearTimeout(timer);
    }
}
