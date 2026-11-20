// Serves the Pro editor child origin (ADR-0358) from an R2 bucket: a tiny read-only Worker with
// its own name, its own route and no secrets. It exists because the 50 MB wasm cannot ride the
// main Worker or Workers Assets, and R2 custom domains cannot set a per-document CSP.
//
// It serves only files listed in the published manifest.json, applies exactly the headers the
// build generated (pro-editor/src/headers.mjs), and refuses to serve at all if the manifest's
// allowed parent origins differ from this deployment's ALLOWED_PARENTS variable.

import { buildHeadersFile } from '../pro-editor/src/headers.mjs';
import { headersFor, parseHeadersFile } from '../pro-editor/src/headerRules.mjs';
import { parseAllowedParents } from '../pro-editor/src/protocol.mjs';

const MANIFEST_KEY = 'manifest.json';
const TTL_MS = 60_000;
const INTERNAL = new Set([MANIFEST_KEY, '_headers']);
const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm',
  json: 'application/json', png: 'image/png', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
};

let cache = { at: 0, site: null };

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

async function loadSite(env, now) {
  if (cache.site && now - cache.at < TTL_MS) return cache.site;
  const object = await env.SITE.get(MANIFEST_KEY);
  if (!object) return { error: 'not-published' };
  let manifest;
  try { manifest = JSON.parse(await object.text()); } catch { return { error: 'bad-manifest' }; }
  const expected = parseAllowedParents(env.ALLOWED_PARENTS || '');
  if (expected.length === 0 || !Array.isArray(manifest.parents) || !sameSet(manifest.parents, expected)) {
    return { error: 'parents-mismatch' };
  }
  if (!manifest.files || typeof manifest.files !== 'object' || !Array.isArray(manifest.styleHashes)) return { error: 'bad-manifest' };
  const site = {
    files: new Set(Object.keys(manifest.files).filter((k) => !INTERNAL.has(k))),
    rules: parseHeadersFile(buildHeadersFile({ parents: expected, styleHashes: manifest.styleHashes })),
  };
  cache = { at: now, site };
  return site;
}

function text(status, body, extra = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}

export async function handle(request, env, now = Date.now()) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'method not allowed', { Allow: 'GET, HEAD' });
  const site = await loadSite(env, now);
  if (site.error) return text(503, 'the Pro editor is not available (' + site.error + ')');

  let path;
  try { path = decodeURIComponent(new URL(request.url).pathname); } catch { return text(400, 'bad request'); }
  if (path === '/') path = '/host.html';
  const key = path.slice(1);
  if (!site.files.has(key)) return text(404, 'not found');

  const object = await env.SITE.get(key);
  if (!object) return text(404, 'not found');

  const headers = new Headers(headersFor(site.rules, path));
  if (!headers.has('Content-Type')) {
    const ext = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1).toLowerCase() : '';
    headers.set('Content-Type', TYPES[ext] || object.httpMetadata?.contentType || 'application/octet-stream');
  }
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (object.httpEtag && request.headers.get('If-None-Match') === object.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
}

export function resetCacheForTests() { cache = { at: 0, site: null }; }

export default {
  fetch: (request, env) => handle(request, env),
};
