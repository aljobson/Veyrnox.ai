// Header rules for the child origin (plan rev 6/7). Emitted as a `_headers` file (Cloudflare
// Pages / Workers Assets format) next to the built site. The child is served from external static
// storage, not the Worker, so these rules are the only place its CSP is set.

const COMMON = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=()',
};

function csp(parts) {
  return parts.join('; ');
}

/** host.html: framed only by the exact apex origins, frames only the inner editor. */
export function hostCsp(parents) {
  return csp([
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'none'",
    "frame-src 'self'",
    "connect-src 'none'",
    "img-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    'frame-ancestors ' + parents.join(' '),
  ]);
}

/** purge.html: same frame rules as the host page, loads no editor and frames nothing. */
export function purgeCsp(parents) {
  return hostCsp(parents).replace("frame-src 'self'", "frame-src 'none'");
}

/**
 * The inner FilmCraft document. CSP checks every ancestor, so frame-ancestors lists the child
 * origin AND the apex origins (the immediate-parent rule is enforced by the gate, not CSP).
 */
export function innerCsp(parents, styleHashes) {
  return csp([
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    'style-src ' + styleHashes.join(' '),
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    // No import-from-URL and no model downloads: only same-origin, blob and data fetches.
    "connect-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-ancestors 'self' " + parents.join(' '),
  ]);
}

function block(path, headers) {
  return path + '\n' + Object.entries(headers).map(([k, v]) => '  ' + k + ': ' + v).join('\n') + '\n';
}

/** @returns {string} contents of the `_headers` file */
export function buildHeadersFile({ parents, styleHashes }) {
  if (!Array.isArray(parents) || parents.length === 0) throw new Error('at least one parent origin is required');
  const immutable = { ...COMMON, 'Cache-Control': 'public, max-age=31536000, immutable' };
  const noCache = { ...COMMON, 'Cache-Control': 'no-cache' };
  return [
    block('/host.html', { ...noCache, 'Content-Security-Policy': hostCsp(parents) }),
    block('/purge.html', { ...noCache, 'Content-Security-Policy': purgeCsp(parents) }),
    block('/fc/index.html', { ...noCache, 'Content-Security-Policy': innerCsp(parents, styleHashes) }),
    block('/fc/*.wasm', { ...immutable, 'Content-Type': 'application/wasm' }),
    block('/fc/*.js', { ...immutable, 'Content-Type': 'text/javascript' }),
    block('/pro/*', { ...noCache, 'Content-Type': 'text/javascript' }),
  ].join('\n');
}
