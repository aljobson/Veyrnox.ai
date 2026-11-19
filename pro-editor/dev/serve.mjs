// Local-only stand-in for the two origins (never deployed): the "apex" page on one port and the
// built child site on another, with the build's `_headers` rules applied. Use localhost for the
// apex and 127.0.0.1 for the child so they are genuinely cross-origin.
//
//   node pro-editor/dev/serve.mjs --dist DIR --apex 8771 --child 8772

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.md': 'text/markdown',
};

export function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!line.startsWith(' ')) { current = { path: line.trim(), headers: {} }; rules.push(current); continue; }
    const i = line.indexOf(':');
    if (current && i > 0) current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return rules;
}

function matches(pattern, path) {
  if (!pattern.includes('*')) return pattern === path;
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(path);
}

function args() {
  const out = {};
  for (let i = 2; i < process.argv.length; i += 2) out[process.argv[i].slice(2)] = process.argv[i + 1];
  return out;
}

// Request data is untrusted: log it quoted and length-capped so it cannot forge log lines.
const logSafe = (text) => JSON.stringify(String(text)).slice(0, 200);

function serveStatic(dist, rules, req, res) {
  const url = new URL(req.url, 'http://x');
  const path = normalize(decodeURIComponent(url.pathname));
  const file = join(dist, path === '/' ? 'host.html' : path);
  if (!resolve(file).startsWith(resolve(dist) + sep) || !existsSync(file) || !statSync(file).isFile()) {
    console.log('404 ' + logSafe(url.pathname));
    res.writeHead(404); res.end('not found'); return;
  }
  console.log(logSafe(req.method) + ' ' + logSafe(url.pathname + url.search));
  const headers = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' };
  for (const rule of rules) if (matches(rule.path, url.pathname === '/' ? '/host.html' : url.pathname)) Object.assign(headers, rule.headers);
  // Dev-only media for manual checks (the apex page fetches it cross-origin).
  if (url.pathname.startsWith('/dev-media/')) headers['Access-Control-Allow-Origin'] = '*';
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args();
  const dist = resolve(a.dist);
  const apexPort = Number(a.apex || 8771);
  const childPort = Number(a.child || 8772);
  const rules = parseHeadersFile(readFileSync(join(dist, '_headers'), 'utf8'));
  const childOrigin = 'http://127.0.0.1:' + childPort;

  createServer((req, res) => serveStatic(dist, rules, req, res)).listen(childPort, '127.0.0.1');
  createServer((req, res) => {
    const page = readFileSync(join(HERE, 'parent.html'), 'utf8').replaceAll('__CHILD_ORIGIN__', childOrigin);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
  }).listen(apexPort, '127.0.0.1');
  console.log('apex http://localhost:' + apexPort + '  child ' + childOrigin);
}
