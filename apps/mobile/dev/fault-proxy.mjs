#!/usr/bin/env node
// Development-only fault-injecting proxy for error testing. Sits on :8799 (where the app expects the mock API) and
// forwards to the real mock on :8800. A control endpoint changes the behaviour at run time:
//   GET /__fault?mode=pass|500|401|403|404|429|slow|drop|badjson|empty|html&match=/api/v1/jobs   (match is a path prefix; default all)
//   GET /__fault/log  -> the last requests the proxy saw
// Never ship or point this at a real backend.
import { createServer, request as httpRequest } from 'node:http';

const LISTEN = Number(process.env.PROXY_PORT || 8799);
const TARGET = Number(process.env.TARGET_PORT || 8800);
let fault = { mode: 'pass', match: '' };
const seen = [];

const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__fault') {
        fault = { mode: url.searchParams.get('mode') || 'pass', match: url.searchParams.get('match') || '' };
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(fault));
    }
    if (url.pathname === '/__fault/log') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(seen.slice(-200)));
    }
    const hit = fault.mode !== 'pass' && url.pathname.startsWith(fault.match || '/') && url.pathname.startsWith('/api');
    seen.push({ t: Date.now(), method: req.method, path: url.pathname, fault: hit ? fault.mode : 'pass' });
    if (hit) {
        const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
        switch (fault.mode) {
            case '500': return json(500, { error: 'internal_error' });
            case '401': return json(401, { error: 'unauthorized' });
            case '403': return json(403, { error: 'forbidden' });
            case '404': return json(404, { error: 'not_found' });
            case '429': res.setHeader('retry-after', '3'); return json(429, { error: 'rate_limited' });
            case 'badjson': res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"truncated":');
            case 'empty': res.writeHead(200, { 'content-type': 'application/json' }); return res.end('');
            case 'html': res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>maintenance</html>');
            case 'drop': return req.socket.destroy();
            case 'slow': return setTimeout(() => forward(req, res), 25_000);
        }
    }
    forward(req, res);
});

function forward(req, res) {
    const upstream = httpRequest({ host: '127.0.0.1', port: TARGET, path: req.url, method: req.method, headers: req.headers }, (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
}

server.listen(LISTEN, () => console.log(`fault proxy :${LISTEN} -> :${TARGET}`));
