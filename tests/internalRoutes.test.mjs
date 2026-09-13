// Regression: ISSUE-001 / ISSUE-002 — internal links pointed at deleted routes
// (/veyrnox/m/plans removed with the subscription tiers, /veyrnox/community never existed),
// so /m and the homepage "Explore all" link both 404'd in production.
// Found by /qa on 2026-09-13
// Report: .gstack/qa-reports/qa-report-veyrnox-ai-2026-09-13.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP = new URL('../app/', import.meta.url).pathname;

const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
});

const files = walk(APP);

// Every rendered route: app/<segments>/page.js -> /<segments>, private (_x) and group dirs excluded.
const routes = new Set(
    files
        .filter((f) => /\/page\.jsx?$/.test(f))
        .map((f) => '/' + relative(APP, f).replace(/\/page\.jsx?$/, ''))
        .map((r) => (r === '/page.js' ? '/' : r)),
);

// next.config.mjs rewrites serve app/veyrnox/* at the bare path, so both spellings resolve.
const exists = (raw) => {
    const path = raw.length > 1 ? raw.replace(/\/$/, '') : raw;
    const candidates = [path, path.startsWith('/veyrnox/') ? path.slice('/veyrnox'.length) : `/veyrnox${path === '/' ? '' : path}`];
    return candidates.some((c) =>
        [...routes].some((route) => {
            const r = route.split('/');
            const p = c.split('/');
            return r.length === p.length && r.every((seg, i) => seg.startsWith('[') || seg === p[i]);
        }),
    );
};

const linked = new Map(); // path -> first source file that links it
for (const file of files.filter((f) => /\.jsx?$/.test(f))) {
    const src = readFileSync(file, 'utf8');
    for (const [, path] of src.matchAll(/(?:href=|redirect\()["'`](\/[^"'`?#]*)/g)) {
        if (path.startsWith('/api/')) continue;
        if (!linked.has(path)) linked.set(path, relative(APP, file));
    }
}

test('every internal link and redirect target resolves to a real page', () => {
    const broken = [...linked].filter(([path]) => !exists(path)).map(([path, from]) => `${path} (from app/${from})`);
    assert.deepEqual(broken, [], `internal links with no page:\n${broken.join('\n')}`);
});

test('the route table and the resolver actually work', () => {
    assert.ok(exists('/veyrnox/m/create'), 'mobile create page is a real route');
    assert.ok(exists('/pricing'), 'rewritten path resolves to app/veyrnox/pricing');
    assert.ok(!exists('/veyrnox/m/plans'), 'the removed plans page must not resolve');
    assert.ok(!exists('/veyrnox/community'), 'there is no community page');
});
