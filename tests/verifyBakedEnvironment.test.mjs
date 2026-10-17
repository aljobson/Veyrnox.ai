import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBakedEnvironment } from '../scripts/verify-baked-environment.mjs';
import { AI_ENVIRONMENTS } from '../packages/security/environments.js';

const SCRIPT = fileURLToPath(new URL('../scripts/verify-baked-environment.mjs', import.meta.url));
const LOCAL = 'http://127.0.0.1:54321', LOCAL_KEY = 'sb_publishable_local_development_unconfigured';
const file = (name, text) => ({ path: name, text });
// What a correct build looks like: the client holds only its own project; the server holds its own URL (and, as in the real bundle, the other
// environments' table in a few files); the middleware's identity function carries the baked APP_ENV as a default argument and the dev branch.
const middlewareFor = (env) => file('middleware/handler.mjs', `function c(e11, t12 = false, r12 = "${env}") {\n let a4 = "development" === r12 ? "${LOCAL}" : rR["staging" === r12 ? "staging" : "production"];`);
const bundleFor = (env) => {
    const own = AI_ENVIRONMENTS[env];
    return {
        assets: [file('chunk-a.js', `x="${own.supabaseUrl}",y="${own.publishableKey}"`), file('chunk-b.js', 'nothing')],
        server: [file('route-a.js', `a="${own.supabaseUrl}"`), file('table.js', `t={s:"${AI_ENVIRONMENTS.staging.supabaseUrl}",p:"${AI_ENVIRONMENTS.production.supabaseUrl}"}`)],
        middleware: [middlewareFor(env)],
    };
};
const failing = (result) => result.checks.filter((c) => !c.ok).map((c) => c.name);

test('a bundle built for the target passes, for staging and for production', () => {
    for (const env of ['staging', 'production']) {
        const result = checkBakedEnvironment(env, bundleFor(env));
        assert.equal(result.ok, true, JSON.stringify(failing(result)));
    }
});

test('the 2026-10-17 bad staging build (no APP_ENV, so the local default is baked in) is refused', () => {
    const bad = {
        assets: [file('chunk-a.js', `x="${LOCAL}",y="${LOCAL_KEY}"`)],
        server: [file('route-a.js', `cfg={supabaseUrl:"${LOCAL}"}`), file('route-b.js', `u="${LOCAL}"`)],
        middleware: [middlewareFor('development')],
    };
    const result = checkBakedEnvironment('staging', bad);
    assert.equal(result.ok, false);
    const names = failing(result).join('|');
    for (const part of ['staging Supabase URL', 'staging publishable key', 'local-development address or key', 'local-development address baked in', 'built for staging']) assert.match(names, new RegExp(part));
    assert.match(result.checks.find((c) => /built for staging/.test(c.name)).detail, /development/);
});

test('a bundle built for the other environment is refused (staging bundle to production and the reverse)', () => {
    for (const [built, target] of [['staging', 'production'], ['production', 'staging']]) {
        const result = checkBakedEnvironment(target, bundleFor(built));
        assert.equal(result.ok, false, `${built} bundle must not pass as ${target}`);
        assert.ok(failing(result).some((n) => /other environment|built for/.test(n)));
    }
});

test('it fails closed: an unrecognised middleware layout, an unknown target and empty client code are not waved through', () => {
    const odd = { ...bundleFor('staging'), middleware: [file('middleware/handler.mjs', 'minified differently')] };
    const result = checkBakedEnvironment('staging', odd);
    assert.equal(result.ok, false);
    assert.match(result.checks.find((c) => /baked environment/.test(c.name)).detail, /cannot be verified/);
    assert.throws(() => checkBakedEnvironment('qa', bundleFor('staging')), /unknown target/);
    assert.equal(checkBakedEnvironment('staging', { ...bundleFor('staging'), assets: [] }).ok, false);
});

function fakeBuild(env) {
    const dir = mkdtempSync(path.join(tmpdir(), 'baked-'));
    const { assets, server, middleware } = bundleFor(env);
    for (const [group, files, sub] of [['assets', assets, '_next/static'], ['server-functions', server, ''], ['middleware', middleware, '']]) {
        const base = group === 'assets' ? path.join(dir, 'assets', sub) : path.join(dir, group);
        mkdirSync(base, { recursive: true });
        for (const f of files) writeFileSync(path.join(base, path.basename(f.path)), f.text);
    }
    return dir;
}
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('the command line exits 0 for a matching bundle, 1 for a mismatch with the rebuild command, and 2 for bad usage', () => {
    const dir = fakeBuild('staging');
    const good = run('staging', dir);
    assert.equal(good.status, 0, good.stderr); assert.match(good.stdout, /OK: baked environment matches staging/);
    const bad = run('production', dir);
    assert.equal(bad.status, 1); assert.match(bad.stderr, /NOT built for production/); assert.match(bad.stderr, /APP_ENV=production/);
    const wrongStaging = run('staging', fakeBuild('production'));
    assert.equal(wrongStaging.status, 1); assert.match(wrongStaging.stderr, /APP_ENV=staging SUPABASE_URL=/);
    assert.equal(run().status, 2); assert.equal(run('qa', dir).status, 2); assert.equal(run('staging', path.join(dir, 'missing')).status, 2);
    const empty = mkdtempSync(path.join(tmpdir(), 'baked-empty-'));
    assert.equal(run('staging', empty).status, 1, 'an empty build output is refused');
});
