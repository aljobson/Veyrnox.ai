import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Route handlers outside /api/v1 carry no verified user: middleware.js does not
// run on other /api/* paths, so an inbound x-veyrnox-auth-* header is not
// stripped there. Each one is listed here with what protects it (CLAUDE.md,
// "Routes outside the gate"). A new one fails this test until it is added on
// purpose.
const OUTSIDE = {
    'app/api/catalog/route.js': 'public read',
    'app/api/credit-packs/route.js': 'public read',
    'app/api/cinema/titles/route.js': 'public read',
    'app/api/cinema/titles/[id]/route.js': 'public read',
    'app/api/popular-templates/route.js': 'public read',
    'app/api/webhook/fal/route.js': 'provider signature',
    'app/api/webhook/kie/route.js': 'provider signature',
    'app/api/webhook/openrouter/route.js': 'provider signature',
    'app/api/webhook/stripe/route.js': 'provider signature',
    'app/api/webhook/montage/route.js': 'provider signature',
    'app/api/webhook/cinema-stream/route.js': 'provider signature',
    'app/api/admin/reap-assets/route.js': 'access + token',
    'app/api/admin/top-up-backfill/route.js': 'access + token',
    'app/media/social/[token]/route.js': 'signed token',
    'app/api/turnstile-failure/route.js': 'rate limit + fixed body',
};

const ROOT = fileURLToPath(new URL('..', import.meta.url));
function routeFiles(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return routeFiles(path);
        return name === 'route.js' ? [relative(ROOT, path).split('\\').join('/')] : [];
    });
}
const found = routeFiles(join(ROOT, 'app')).filter((f) => !f.startsWith('app/api/v1/'));

test('every route outside /api/v1 is listed with its protection', () => {
    assert.deepEqual([...found].sort(), Object.keys(OUTSIDE).sort());
});

test('no route outside /api/v1 reads a client-spoofable identity header', () => {
    for (const file of found) {
        assert.ok(!/x-veyrnox-auth/.test(readFileSync(join(ROOT, file), 'utf8')), `${file} reads x-veyrnox-auth-*`);
    }
});

test('the admin routes check Cloudflare Access and a token', () => {
    for (const file of found.filter((f) => OUTSIDE[f] === 'access + token')) {
        const src = readFileSync(join(ROOT, file), 'utf8');
        assert.match(src, /requireAccess\(req\)/, file);
        assert.match(src, /tokenMatches\(/, file);
    }
});

// An anonymous write: the Worker limits it per connecting IP before the app,
// and the handler takes one Turnstile error code or one fixed word and
// nothing else (ADR-0026 amendments 2 and 5, tests/turnstileFailureReport.test.mjs).
test('the anonymous report is rate limited in the Worker and handled in one place', () => {
    const worker = readFileSync(join(ROOT, 'worker.js'), 'utf8');
    const fetchHandler = worker.slice(worker.indexOf('async fetch(request, env, ctx) {'), worker.indexOf('async scheduled('));
    assert.ok(fetchHandler.indexOf('turnstileReportRateLimit(request, env)') > 0, 'worker.js does not limit the report');
    assert.ok(fetchHandler.indexOf('turnstileReportRateLimit(request, env)') < fetchHandler.indexOf('handler.fetch('), 'limited after the app');
    for (const file of found.filter((f) => OUTSIDE[f] === 'rate limit + fixed body')) {
        const src = readFileSync(join(ROOT, file), 'utf8');
        assert.match(src, /export async function POST\(request\) \{\s*return acceptTurnstileFailure\(request\);\s*\}/, file);
        assert.equal(src.match(/^export /gm).length, 1, `${file} answers POST only`);
    }
});

test('CLAUDE.md names the public routes', () => {
    const rules = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
    for (const path of ['/api/catalog', '/api/credit-packs', '/api/cinema/titles', '/api/webhook/*', '/api/admin/*', '/media/social/:token', '/api/turnstile-failure']) {
        assert.ok(rules.includes(path), `CLAUDE.md does not mention ${path}`);
    }
});
