import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTO_PRODUCT_INVENTORY } from '../lib/generatedProductInventory.js';

// A link written into a page must lead to a page that exists. Three shipped
// pointing at /app/video-dubbing, /app/talking-avatar and /app/product-avatar,
// which had no page file and answered 404 (QA assessment, 2026-11-13).
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(js|jsx)$/.test(name) ? [path] : [];
});
const routes = AUTO_PRODUCT_INVENTORY.map(({ route }) => route);
const matcher = (route) => new RegExp(`^${route.split('/').map((part) => (/^\[.+\]$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
const exact = routes.map(matcher);
const hasChild = (prefix) => routes.some((route) => route.startsWith(prefix) && route.length > prefix.length);

const check = (target, next, where, dead) => {
    // `/app/music/songs/${id}` is a prefix; anything else is a whole path.
    const prefix = target.length > 5 && target.endsWith('/') && next === '$';
    const path = prefix ? target : target.replace(/\/$/, '');
    if (!(prefix ? hasChild(path) : exact.some((re) => re.test(path)))) dead.push(`${where}: ${target}`);
};

test('every /app link written into a page leads to a page that exists', () => {
    const dead = [];
    for (const file of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))]) {
        const source = readFileSync(file, 'utf8');
        const where = relative(ROOT, file);
        // href="/app/x", href={`/app/x?y=${z}`}
        for (const [, target, next] of source.matchAll(/href=\{?\s*["'`](\/app(?:\/[A-Za-z0-9_\-/]*)?)(.)/g)) check(target, next, where, dead);
        // const somethingHref = cond ? '/app/x?y' : '/app/z';
        for (const [statement] of source.matchAll(/\b[A-Za-z]*Href\s*=[^=][^;]*;/g)) {
            for (const [, target, next] of statement.matchAll(/["'`](\/app(?:\/[A-Za-z0-9_\-/]*)?)(.)/g)) check(target, next, where, dead);
        }
    }
    assert.deepEqual([...new Set(dead)], []);
});
