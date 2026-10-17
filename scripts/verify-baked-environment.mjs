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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_ENVIRONMENTS } from '../packages/security/environments.js';

const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_KEY = 'sb_publishable_local_development_unconfigured';
const quoted = (text) => `"${text}"`;
// The middleware bundle carries the identity function with the baked APP_ENV as its default argument:
//   (..., r = "staging") { let a = "development" === r ? "http://127.0.0.1:54321" : ...
const MIDDLEWARE_DEFAULT_ENV = /(\w+)\s*=\s*"(development|staging|production)"\s*\)\s*\{\s*let\s+\w+\s*=\s*"development"\s*===\s*\1\s*\?\s*"http:\/\/127\.0\.0\.1:54321"/;

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
    add('no server file has the local-development address baked in', countIn(server, quoted(LOCAL_URL)) === 0, where(server, quoted(LOCAL_URL)));

    const found = middleware.map((f) => f.text.match(MIDDLEWARE_DEFAULT_ENV)).find(Boolean);
    if (!found) add('middleware reports its baked environment', false, 'pattern not found: the bundle layout changed, so this cannot be verified; update scripts/verify-baked-environment.mjs');
    else add(`middleware was built for ${target}`, found[2] === target, `built for "${found[2]}"`);
    return { ok: checks.every((c) => c.ok), checks };
}

const TEXT = /\.(?:m?js|json|html|txt)$/;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
// Each file is opened once: the directory listing says what is a directory, the file is read in one call, and its size is judged from what
// was read, so nothing can change between a check and the read (CodeQL js/file-system-race).
function walk(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (err) { if (err.code === 'ENOENT') return out; throw err; }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.isFile() && TEXT.test(entry.name)) {
            const text = readFileSync(full, 'utf8');
            if (text.length < MAX_FILE_BYTES) out.push({ path: full, text });
        }
    }
    return out;
}

export function readBundle(dir) {
    return {
        assets: walk(path.join(dir, 'assets', '_next', 'static')),
        server: walk(path.join(dir, 'server-functions')),
        middleware: walk(path.join(dir, 'middleware')),
    };
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
    const [target, dir = '.open-next'] = process.argv.slice(2);
    if (!target || !AI_ENVIRONMENTS[target]) { console.error('usage: node scripts/verify-baked-environment.mjs <staging|production> [.open-next]'); process.exit(2); }
    const bundle = readBundle(dir);
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
