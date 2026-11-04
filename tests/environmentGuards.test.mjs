// S1 of the data-protection plan: the environment label, the hand-run
// production guard and the production/staging isolation check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { environmentLabel } from '../packages/security/environmentLabel.js';
import { checkProductionAck, PRODUCTION_FLAG } from '../packages/security/productionGuard.js';
import { findIsolationProblems, WALLET_PROJECT_REFS } from '../packages/security/environmentIsolation.js';
import { AI_ENVIRONMENTS } from '../packages/security/environments.js';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';

const RAW = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const config = () => parseJsonc(RAW);

const PROD_URL = AI_ENVIRONMENTS.production.supabaseUrl;
const STAGING_URL = AI_ENVIRONMENTS.staging.supabaseUrl;

const RT = (appEnv, supabaseUrl) => ({ appEnv, supabaseUrl });

test('PRODUCTION and STAGING need request-scoped Worker bindings that agree with the baked values', () => {
    assert.equal(environmentLabel('production', PROD_URL, RT('production', PROD_URL)).label, 'PRODUCTION');
    assert.equal(environmentLabel('production', `${PROD_URL}/`, RT('production', `${PROD_URL}/`)).label, 'PRODUCTION');
    assert.equal(environmentLabel('staging', STAGING_URL, RT('staging', STAGING_URL)).label, 'STAGING');
});

test('a staging bundle on production bindings (or the reverse), or missing bindings, is UNKNOWN', () => {
    const cases = [
        ['staging', STAGING_URL, RT('production', PROD_URL)], ['staging', STAGING_URL, RT('staging', PROD_URL)],
        ['production', PROD_URL, RT('staging', STAGING_URL)], ['production', PROD_URL, RT(undefined, undefined)],
        ['production', PROD_URL, null], ['staging', STAGING_URL, null], ['production', PROD_URL, RT('production', undefined)],
        ['production', STAGING_URL, RT('production', PROD_URL)], ['production', PROD_URL, RT('production', STAGING_URL)],
    ];
    for (const [env, url, runtime] of cases) {
        const out = environmentLabel(env, url, runtime);
        assert.equal(out.kind, 'unknown', JSON.stringify([env, url, runtime]));
        assert.match(out.detail, /production/i);
    }
});

test('LOCAL needs APP_ENV development and an explicit loopback database; nothing else reads as local', () => {
    assert.equal(environmentLabel('development', 'http://127.0.0.1:54321', null).kind, 'local');
    assert.equal(environmentLabel('development', 'http://localhost:54321', RT('development', 'http://127.0.0.1:54321')).kind, 'local');
    const cases = [
        ['development', undefined, null], ['development', '', null], ['development', 'not a url', null],
        ['development', 'https://jwstkrtslotnjyerzzsi.supabase.co', null], ['development', 'https://nszlbcmcysftwyudthjz.supabase.co', null],
        ['development', 'https://example.test', null], ['development', PROD_URL, null], ['development', STAGING_URL, null],
        ['development', 'http://127.0.0.1:54321', RT('production', PROD_URL)],
        ['development', 'http://127.0.0.1:54321', RT('development', PROD_URL)],
        [undefined, undefined, null], ['', PROD_URL, null], ['prod', PROD_URL, RT('prod', PROD_URL)], ['Production', PROD_URL, RT('Production', PROD_URL)],
    ];
    for (const [env, url, runtime] of cases) {
        assert.equal(environmentLabel(env, url, runtime).kind, 'unknown', JSON.stringify([env, url, runtime]));
    }
});

test('a hand-run write against production is refused without the flag', () => {
    const prod = AI_ENVIRONMENTS.production.supabaseUrl;
    const out = checkProductionAck({ supabaseUrl: prod, argv: ['apply'], env: {}, action: 'apply-migrations' });
    assert.equal(out.ok, false);
    assert.equal(out.target, 'production');
    assert.match(out.message, /PRODUCTION/);
    assert.match(out.message, new RegExp(PRODUCTION_FLAG));
});

const APPROVED_JOB = { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'apply-migrations', GITHUB_REF: 'refs/heads/main', GITHUB_JOB: 'apply' };

test('the flag, the approved apply job, or staging lets the write continue', () => {
    assert.equal(checkProductionAck({ supabaseUrl: PROD_URL, argv: [PRODUCTION_FLAG], env: {}, action: 'x' }).ok, true);
    assert.equal(checkProductionAck({ supabaseUrl: PROD_URL, argv: [], env: APPROVED_JOB, action: 'x' }).ok, true);
    assert.equal(checkProductionAck({ supabaseUrl: STAGING_URL, argv: [], env: {}, action: 'x' }).ok, true);
});

test('unrelated Actions jobs, other workflows, branches or job names are NOT exempt', () => {
    for (const patch of [
        { GITHUB_ACTIONS: 'false' }, { GITHUB_WORKFLOW: 'ci' }, { GITHUB_REF: 'refs/heads/feature' },
        { GITHUB_REF: 'refs/pull/1/merge' }, { GITHUB_JOB: 'plan' }, { GITHUB_JOB: undefined },
    ]) {
        const out = checkProductionAck({ supabaseUrl: PROD_URL, argv: [], env: { ...APPROVED_JOB, ...patch }, action: 'x' });
        assert.equal(out.ok, false, JSON.stringify(patch));
    }
});

test('a Postgres connection string is classified: production and unknown remotes refused, local and staging allowed', () => {
    const run = (databaseUrl, env = {}) => checkProductionAck({ databaseUrl, argv: [], env, action: 'migrate' });
    const prodRef = new URL(PROD_URL).hostname.split('.')[0];
    const stagingRef = new URL(STAGING_URL).hostname.split('.')[0];
    assert.equal(run(`postgres://postgres:pw@db.${prodRef}.supabase.co:5432/postgres`).ok, false);
    assert.equal(run(`postgres://postgres.${prodRef}:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`).target, 'production');
    assert.equal(run(`postgres://postgres.${prodRef}:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`).ok, false);
    assert.equal(run(`postgres://postgres:pw@db.${stagingRef}.supabase.co:5432/postgres`).ok, true);
    assert.equal(run('postgres://veyrnox@localhost:55441/postgres').ok, true);
    assert.equal(run('postgres://veyrnox@127.0.0.1/postgres').target, 'local');
    for (const bad of ['postgres://u:p@db.jwstkrtslotnjyerzzsi.supabase.co:5432/postgres', 'postgres://u:p@example.test/db', 'not a url']) {
        assert.equal(run(bad).ok, false, bad);
        assert.equal(run(bad).target, 'unknown');
    }
    // node-postgres lets query parameters override the host or user, and a hostless URL falls back to PGHOST.
    for (const sneaky of [
        `postgres://postgres:pw@localhost/postgres?host=db.${prodRef}.supabase.co`,
        `postgres://postgres:pw@localhost/postgres?hostaddr=203.0.113.9`,
        `postgres://postgres:pw@db.${stagingRef}.supabase.co/postgres?user=postgres.${prodRef}`,
        'postgres:///postgres', 'postgres:///postgres?host=/tmp/pgsock', 'postgres://localhost/postgres?port=5432&dbname=x',
        `postgres://postgres.${prodRef}:pw@evil.example.test:6543/postgres`,
        `postgres://postgres:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
        `mysql://u:p@localhost/db`,
    ]) {
        const out = run(sneaky);
        assert.equal(out.ok, false, sneaky);
        assert.notEqual(out.target, 'local', sneaky);
    }
    assert.equal(run('postgres://veyrnox@localhost:55441/postgres?sslmode=disable').ok, true);
    // The approved apply job exemption never covers an unknown or wallet target.
    assert.equal(run('postgres://u:p@example.test/db', APPROVED_JOB).ok, false);
    // A mixed pair resolves to the most dangerous target.
    const both = checkProductionAck({ supabaseUrl: STAGING_URL, databaseUrl: `postgres://u:p@db.${prodRef}.supabase.co/postgres`, argv: [], env: {}, action: 'x' });
    assert.equal(both.target, 'production');
    assert.equal(both.ok, false);
});

test('an unknown or wallet Supabase URL is refused even inside the approved job; only the flag overrides', () => {
    for (const url of ['', 'https://jwstkrtslotnjyerzzsi.supabase.co', 'https://nszlbcmcysftwyudthjz.supabase.co', 'https://example.test']) {
        const noFlag = checkProductionAck({ supabaseUrl: url, argv: [], env: APPROVED_JOB, action: 'x' });
        assert.equal(noFlag.ok, false, url);
        assert.equal(noFlag.target, 'unknown');
    }
});

test('the real wrangler.jsonc keeps production and staging isolated', () => {
    assert.deepEqual(findIsolationProblems(config(), RAW), []);
});

test('isolation check catches a shared database, shared key, missing staging var and a wallet ref', () => {
    const shared = config();
    shared.env.staging.vars.SUPABASE_URL = shared.vars.SUPABASE_URL;
    assert.ok(findIsolationProblems(shared, RAW).some((p) => /SUPABASE_URL is identical/.test(p)));

    const key = config();
    key.env.staging.vars.NEXT_PUBLIC_SUPABASE_ANON_KEY = key.vars.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    assert.ok(findIsolationProblems(key, RAW).some((p) => /ANON_KEY is identical/.test(p)));

    const missing = config();
    delete missing.env.staging.vars.ACCESS_AUD;
    assert.ok(findIsolationProblems(missing, RAW).some((p) => /ACCESS_AUD is missing/.test(p)));

    const wrongEnv = config();
    wrongEnv.vars.APP_ENV = 'staging';
    assert.ok(findIsolationProblems(wrongEnv, RAW).some((p) => /APP_ENV must be "production"/.test(p)));

    assert.ok(findIsolationProblems(config(), `${RAW}\n// ${WALLET_PROJECT_REFS[0]}`).some((p) => /wallet project ref/.test(p)));
});

test('isolation check catches a staging host that is a production hostname, and swapped public URLs', () => {
    for (const host of ['https://veyrnox.ai', 'https://www.veyrnox.ai/', 'https://APP.veyrnox.ai']) {
        const c = config();
        c.env.staging.vars.PUBLIC_HOST = host;
        assert.ok(findIsolationProblems(c, RAW).some((p) => /production hostname/.test(p)), host);
    }
    const swapped = config();
    [swapped.vars.NEXT_PUBLIC_SUPABASE_URL, swapped.env.staging.vars.NEXT_PUBLIC_SUPABASE_URL] =
        [swapped.env.staging.vars.NEXT_PUBLIC_SUPABASE_URL, swapped.vars.NEXT_PUBLIC_SUPABASE_URL];
    const problems = findIsolationProblems(swapped, RAW);
    assert.ok(problems.some((p) => /production NEXT_PUBLIC_SUPABASE_URL does not match/.test(p)));
    assert.ok(problems.some((p) => /staging NEXT_PUBLIC_SUPABASE_URL does not match/.test(p)));
    // The same project written with a trailing slash is still the same project.
    const slash = config();
    slash.vars.NEXT_PUBLIC_SUPABASE_URL = `${slash.vars.NEXT_PUBLIC_SUPABASE_URL}/`;
    assert.deepEqual(findIsolationProblems(slash, RAW), []);
});
