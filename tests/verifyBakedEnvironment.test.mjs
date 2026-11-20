import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBakedEnvironment, readBundle } from '../scripts/verify-baked-environment.mjs';
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
const temporaryDirectories = [];
const temporaryDirectory = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'baked-'));
    temporaryDirectories.push(dir);
    return dir;
};
afterEach(() => {
    for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
// The compact CSP function retained in webpack's .next/server/middleware.js.
const webpackCsp = (env) => `function(a,b=!1,c="${env}"){let d="development"===c?"${LOCAL}":c3["staging"===c?"staging":"production"].supabaseUrl;}`;

test('webpack server copies exempt only the known CSP branch with the requested default', () => {
    for (const target of ['staging', 'production']) {
        const bundle = bundleFor(target);
        bundle.server.push(file('default/.next/server/middleware.js', webpackCsp(target)));
        assert.equal(checkBakedEnvironment(target, bundle).ok, true);
        for (const baked of ['development', target === 'staging' ? 'production' : 'staging']) {
            const bad = { ...bundle, server: [...bundle.server, file('copy.js', webpackCsp(baked))] };
            assert.ok(failing(checkBakedEnvironment(target, bad)).includes('no server file has the local-development address baked in'));
        }
    }
});

test('every CSP occurrence is checked in both server and middleware, including later files', () => {
    for (const target of ['staging', 'production']) {
        for (const group of ['server', 'middleware']) {
            for (const badDefault of ['development', target === 'staging' ? 'production' : 'staging']) {
                for (const separateFiles of [false, true]) {
                    const bundle = bundleFor(target);
                    const good = webpackCsp(target), bad = webpackCsp(badDefault);
                    bundle[group].push(...(separateFiles
                        ? [file('first.js', good), file('second.js', bad)]
                        : [file('copies.js', good + bad)]));
                    assert.equal(checkBakedEnvironment(target, bundle).ok, false, `${target}/${group}/${badDefault}/${separateFiles}`);
                }
            }
        }
    }
});

test('a valid CSP exemption never excuses another local address or a different condition', () => {
    for (const group of ['server', 'middleware']) {
        for (const stray of [`x="${LOCAL}"`, `x='${LOCAL}'`, webpackCsp('staging').replace('===c?', '===other?')]) {
            const bundle = bundleFor('staging');
            bundle[group].push(file('extra.js', webpackCsp('staging') + stray));
            assert.equal(checkBakedEnvironment('staging', bundle).ok, false);
        }
    }
});

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
    const dir = temporaryDirectory();
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
    const empty = temporaryDirectory();
    assert.equal(run('staging', empty).status, 1, 'an empty build output is refused');
});

test('readBundle and the CLI inspect oversized server files in full', () => {
    const dir = fakeBuild('production');
    const handler = path.join(dir, 'server-functions', 'handler.mjs');
    // A long identifier-like payload also exercises matching on bundled data.
    const padding = `/*${'a'.repeat(26 * 1024 * 1024)}*/`;
    writeFileSync(handler, padding + webpackCsp('production'));
    const clean = readBundle(dir);
    assert.ok(clean.server.find((f) => f.path === handler).text.length > 25 * 1024 * 1024);
    assert.equal(checkBakedEnvironment('production', clean).ok, true);
    assert.equal(run('production', dir).status, 0);
    writeFileSync(handler, padding + webpackCsp('production') + `;const stray="${LOCAL}";`);
    assert.equal(checkBakedEnvironment('production', readBundle(dir)).ok, false);
    const bad = run('production', dir);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /FAIL  no server file has the local-development address baked in/);
    assert.match(bad.stdout, /handler\.mjs/);
});

test('a 40 MiB server file with many development fragments still exposes a forbidden literal', () => {
    const dir = fakeBuild('production');
    const fragment = ',x="development"';
    const payload = fragment.repeat(Math.ceil(40 * 1024 * 1024 / fragment.length));
    const handler = path.join(dir, 'server-functions', 'handler.mjs');
    writeFileSync(handler, `/*${payload}*/const forbidden="${LOCAL}";`);
    const bundle = readBundle(dir);
    assert.ok(bundle.server.find((f) => f.path === handler).text.length >= 40 * 1024 * 1024);
    assert.equal(checkBakedEnvironment('production', bundle).ok, false);
    const result = run('production', dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL  no server file has the local-development address baked in.*handler\.mjs/);
});

test('a dangling text-file symlink fails explicitly instead of disappearing from the scan', () => {
    const dir = fakeBuild('staging');
    symlinkSync(path.join(dir, 'missing.mjs'), path.join(dir, 'server-functions', 'handler.mjs'));
    assert.throws(() => readBundle(dir), /cannot inspect .*handler\.mjs/);
    const result = run('staging', dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Build inspection failed: cannot inspect .*handler\.mjs/);
});

test('an in-tree text-file symlink is read and a forbidden literal in its target is detected', () => {
    const dir = fakeBuild('staging');
    const target = path.join(dir, 'linked-source.js');
    const link = path.join(dir, 'server-functions', 'linked.js');
    writeFileSync(target, 'const safe = true;');
    symlinkSync('../linked-source.js', link);
    const clean = readBundle(dir);
    assert.equal(clean.server.find((f) => f.path === link)?.text, 'const safe = true;');
    assert.equal(checkBakedEnvironment('staging', clean).ok, true);
    assert.equal(run('staging', dir).status, 0);
    writeFileSync(target, `const forbidden = "${LOCAL}";`);
    assert.equal(checkBakedEnvironment('staging', readBundle(dir)).ok, false);
    const bad = run('staging', dir);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /FAIL  no server file has the local-development address baked in.*linked\.js/);
});

test('a text-file symlink outside the build directory fails explicitly', () => {
    const dir = fakeBuild('staging');
    // A shared path prefix must not count as containment.
    const outside = `${dir}-outside`;
    temporaryDirectories.push(outside);
    mkdirSync(outside);
    const target = path.join(outside, 'source.js');
    writeFileSync(target, 'const safe = true;');
    symlinkSync(target, path.join(dir, 'server-functions', 'outside.js'));
    assert.throws(() => readBundle(dir), /cannot inspect .*outside\.js: symbolic link points outside the build directory/);
    const result = run('staging', dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Build inspection failed: cannot inspect .*outside\.js/);
});

test('a text-file symlink loop fails explicitly', () => {
    const dir = fakeBuild('staging');
    symlinkSync('loop.js', path.join(dir, 'server-functions', 'loop.js'));
    assert.throws(() => readBundle(dir), /cannot inspect .*loop\.js:.*ELOOP/);
    const result = run('staging', dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Build inspection failed: cannot inspect .*loop\.js/);
});

test('non-text symlinks and directory symlinks are skipped without traversing their targets', () => {
    const dir = fakeBuild('staging');
    const outside = temporaryDirectory();
    writeFileSync(path.join(outside, 'forbidden.js'), `const forbidden = "${LOCAL}";`);
    const server = path.join(dir, 'server-functions');
    symlinkSync('missing', path.join(server, 'non-text-link'));
    symlinkSync(outside, path.join(server, 'directory-link'));
    symlinkSync(outside, path.join(server, 'directory-link.js'));
    const bundle = readBundle(dir);
    assert.equal(bundle.server.length, bundleFor('staging').server.length);
    assert.equal(checkBakedEnvironment('staging', bundle).ok, true);
    assert.equal(run('staging', dir).status, 0);
});
