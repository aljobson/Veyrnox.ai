#!/usr/bin/env node
// Refuses a built bundle whose baked-in environment is not the one it is about to be deployed to.
//
//   node scripts/verify-baked-environment.mjs <staging|production> [.open-next]
//
// next.config.mjs inlines APP_ENV, SUPABASE_URL and the public Supabase settings at BUILD time (packages/security/config.js falls back to
// http://127.0.0.1:54321 unless APP_ENV is staging or production). A staging build made without APP_ENV=staging therefore deploys cleanly
// and then calls the local-development address from the Worker, which Cloudflare refuses (error 1003). On 2026-10-17 that left staging's
// top_up_backfill red for 21 hours (#908). Run this between `npm run build:worker` and `wrangler deploy`. Exit 0 = matches, 1 = does not
// match or cannot be verified (it fails closed), 2 = bad usage.
import { closeSync, constants, existsSync, fstatSync, openSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_ENVIRONMENTS } from '../packages/security/environments.js';

const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_KEY = 'sb_publishable_local_development_unconfigured';
const quoted = (text) => `"${text}"`;
// The middleware bundle carries the identity function with the baked APP_ENV as its default argument:
//   (..., r = "staging") { let a = "development" === r ? "http://127.0.0.1:54321" : ...
// Start at a parameter delimiter, so long bundled strings cannot cause quadratic
// retries at each character of an apparent identifier.
const MIDDLEWARE_DEFAULT_ENV = /[(,]\s*([A-Za-z_$][\w$]*)\s*=\s*"(development|staging|production)"\s*\)\s*\{\s*let\s+[\w$]+\s*=\s*"development"\s*===\s*\1\s*\?\s*"http:\/\/127\.0\.0\.1:54321"\s*:/g;

// Webpack retains this unused CSP branch, including copies under server-functions.
// Remove only the matched URL with the requested default; inspect every other occurrence.
const hasForbiddenLocalUrl = (text, target) => text.includes(LOCAL_URL) && text.replace(MIDDLEWARE_DEFAULT_ENV,
    (match, _parameter, baked) => baked === target ? match.replace(LOCAL_URL, '') : match,
).includes(LOCAL_URL);

const countIn = (files, needle) => files.filter((f) => f.text.includes(needle)).length;
const where = (files, needle) => files.filter((f) => f.text.includes(needle)).slice(0, 3).map((f) => f.path).join(', ');

/**
 * Pure check over file contents: { assets, server, middleware } each [{ path, text }]. Returns { ok, checks: [{ name, ok, detail }] }.
 */
export function checkBakedEnvironment(target, { assets, server, middleware }) {
    const expected = AI_ENVIRONMENTS[target];
    if (!expected) throw new Error(`unknown target "${target}"`);
    const others = Object.entries(AI_ENVIRONMENTS).filter(([name]) => name !== target).map(([, env]) => env);
    const checks = [];
    const add = (name, ok, detail = '') => checks.push({ name, ok, detail });

    add(`browser code holds the ${target} Supabase URL`, countIn(assets, expected.supabaseUrl) > 0, `${countIn(assets, expected.supabaseUrl)} client files`);
    add(`browser code holds the ${target} publishable key`, countIn(assets, expected.publishableKey) > 0, `${countIn(assets, expected.publishableKey)} client files`);
    for (const other of others) {
        add('browser code holds no other environment\'s URL or key', countIn(assets, other.supabaseUrl) + countIn(assets, other.publishableKey) === 0, where(assets, other.supabaseUrl) || where(assets, other.publishableKey));
    }
    add('browser code holds no local-development address or key', countIn(assets, LOCAL_URL) + countIn(assets, LOCAL_KEY) === 0, where(assets, LOCAL_URL) || where(assets, LOCAL_KEY));
    add(`server code holds the ${target} Supabase URL`, countIn(server, quoted(expected.supabaseUrl)) > 0, `${countIn(server, quoted(expected.supabaseUrl))} server files`);
    const forbidden = [...server, ...middleware].filter((f) => hasForbiddenLocalUrl(f.text, target));
    add('no server file has the local-development address baked in', forbidden.length === 0, forbidden.slice(0, 3).map((f) => f.path).join(', '));

    const found = middleware.flatMap((f) => [...f.text.matchAll(MIDDLEWARE_DEFAULT_ENV)]);
    if (!found.length) add('middleware reports its baked environment', false, 'pattern not found: the bundle layout changed, so this cannot be verified; update scripts/verify-baked-environment.mjs');
    else add(`middleware was built for ${target}`, found.every((match) => match[2] === target), `built for ${[...new Set(found.map((match) => match[2]))].join(', ')}`);
    return { ok: checks.every((c) => c.ok), checks };
}

const TEXT = /\.(?:[cm]?js|json|html|txt)$/;
// Read complete files, including the large OpenNext handler. Missing top-level groups
// are checked below; a disappearing subtree or unreadable file must fail inspection.
// Inspect and read through one open handle (CodeQL js/file-system-race). Descriptor
// reads also avoid the slow UTF-8 pathname read observed on this checkout's runtime.
function walk(dir, buildDir, out = [], optional = true) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (err) {
        if (optional && err.code === 'ENOENT') return out;
        throw new Error(`cannot inspect ${dir}: ${err.message}`, { cause: err });
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, buildDir, out, false);
        else if (TEXT.test(entry.name)) {
            try {
                let readable = full;
                if (entry.isSymbolicLink()) {
                    readable = realpathSync(full);
                    const relative = path.relative(realpathSync(buildDir), readable);
                    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                        // Outside directory links are skipped, never opened or traversed.
                        if (statSync(readable).isDirectory()) continue;
                        throw new Error('symbolic link points outside the build directory');
                    }
                } else if (!entry.isFile()) throw new Error('not a regular file');
                // NOFOLLOW refuses a last-component link swap; NONBLOCK lets fstat
                // reject a FIFO without waiting for a writer.
                const fd = openSync(readable, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                try {
                    const target = fstatSync(fd);
                    if (entry.isSymbolicLink() && target.isDirectory()) continue;
                    if (!target.isFile()) throw new Error('not a regular file');
                    out.push({ path: full, text: readFileSync(fd, 'utf8') });
                } finally { closeSync(fd); }
            }
            catch (err) { throw new Error(`cannot inspect ${full}: ${err.message}`, { cause: err }); }
        }
    }
    return out;
}

export function readBundle(dir) {
    return {
        assets: walk(path.join(dir, 'assets', '_next', 'static'), dir),
        server: walk(path.join(dir, 'server-functions'), dir),
        middleware: walk(path.join(dir, 'middleware'), dir),
    };
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
    const [target, dir = '.open-next'] = process.argv.slice(2);
    if (!target || !AI_ENVIRONMENTS[target]) { console.error('usage: node scripts/verify-baked-environment.mjs <staging|production> [.open-next]'); process.exit(2); }
    let bundle;
    try { bundle = readBundle(dir); }
    catch (err) { console.error(`Build inspection failed: ${err.message}`); process.exit(1); }
    if (!bundle.assets.length || !bundle.server.length) {
        // Only now, to pick the message and exit code: 2 = nothing there at all, 1 = there but empty or incomplete.
        if (!existsSync(dir)) { console.error(`no build output at ${dir}: run npm run build:worker first`); process.exit(2); }
        console.error(`${dir} looks incomplete (${bundle.assets.length} client files, ${bundle.server.length} server files)`); process.exit(1);
    }
    const result = checkBakedEnvironment(target, bundle);
    for (const c of result.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
    if (!result.ok) {
        const rebuild = target === 'staging'
            ? `APP_ENV=staging SUPABASE_URL=${AI_ENVIRONMENTS.staging.supabaseUrl} NEXT_PUBLIC_SUPABASE_URL=${AI_ENVIRONMENTS.staging.supabaseUrl} NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging publishable key from wrangler.jsonc> PUBLIC_HOST=<staging host> npm run build:worker`
            : 'APP_ENV=production npm run build:worker   (deploy-production.yml sets this)';
        console.error(`\nThis bundle was NOT built for ${target}. Do not deploy it. Rebuild with the full environment:\n  ${rebuild}`);
        process.exit(1);
    }
    console.log(`\nOK: baked environment matches ${target}.`);
}
