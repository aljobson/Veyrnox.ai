import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { catalogLine, productionUrl, readsProduction } from '../scripts/lib/catalog-target.mjs';

const PRODUCTION = 'https://prodprojectref.supabase.co';
const STAGING = 'https://stagingprojectref.supabase.co';
const WRANGLER = [
    '{',
    '  // Public config. SUPABASE_URL is used by middleware.js.',
    '  "vars": {',
    `    "SUPABASE_URL": "${PRODUCTION}",`,
    '    "CHAT_ENABLED": "false"',
    '  },',
    '  "env": {',
    '    "staging": {',
    `      "vars": { "SUPABASE_URL": "${STAGING}" }`,
    '    }',
    '  },',
    '  // a closing note',
    '}',
].join('\n');
const committed = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

test("production is the top-level vars in wrangler.jsonc, not an environment's", () => {
    assert.equal(productionUrl(WRANGLER), PRODUCTION);
    assert.throws(() => productionUrl('{ "env": { "staging": { "vars": { "SUPABASE_URL": "https://x.supabase.co" } } } }'), /no top-level vars\.SUPABASE_URL/);
    assert.throws(() => productionUrl('{ "vars": { "SUPABASE_URL": "" } }'), /no top-level vars\.SUPABASE_URL/);
});

test('the committed wrangler.jsonc names a production project that is not the staging one', () => {
    const production = productionUrl(committed);
    assert.match(production, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
    const staging = committed.slice(committed.indexOf('"staging"')).match(/"SUPABASE_URL":\s*"([^"]+)"/)[1];
    assert.notEqual(new URL(staging).host, new URL(production).host);
    assert.equal(readsProduction(production, production), true);
    assert.equal(readsProduction(staging, production), false);
});

test('a catalog is production when its origin is the production origin', () => {
    assert.equal(readsProduction(PRODUCTION, PRODUCTION), true);
    // The path is not part of which project it is; the script only uses the origin.
    assert.equal(readsProduction(`${PRODUCTION}/`, PRODUCTION), true);
    assert.equal(readsProduction(`${PRODUCTION}/rest/v1`, PRODUCTION), true);
    assert.equal(readsProduction('https://PRODPROJECTREF.supabase.co', PRODUCTION), true);

    assert.equal(readsProduction(STAGING, PRODUCTION), false);
    // A host that only contains the production one.
    assert.equal(readsProduction('https://prodprojectref.supabase.co.example.com', PRODUCTION), false);
    assert.equal(readsProduction('https://xprodprojectref.supabase.co', PRODUCTION), false);
    assert.equal(readsProduction('https://example.com/prodprojectref.supabase.co', PRODUCTION), false);
    assert.equal(readsProduction('https://prodprojectref.supabase.co:8443', PRODUCTION), false);
    assert.equal(readsProduction('http://prodprojectref.supabase.co', PRODUCTION), false);
    assert.equal(readsProduction('https://prodprojectref.supabase.co@example.com', PRODUCTION), false);
    // A user and password would pass on the host, and a failed fetch prints the URL whole.
    assert.equal(readsProduction('https://user:password@prodprojectref.supabase.co', PRODUCTION), false);
    assert.equal(readsProduction('https://user@prodprojectref.supabase.co', PRODUCTION), false);
    // Not set, or not a URL.
    for (const given of [undefined, null, '', 'prodprojectref.supabase.co', 'not a url']) {
        assert.equal(readsProduction(given, PRODUCTION), false, String(given));
    }
});

// In the workflow SUPABASE_URL is a repository secret. The line says which
// catalog it is by naming production, which wrangler.jsonc makes public, and
// never the value it was given.
test('the first line says production or not, and names only the production host', () => {
    assert.equal(catalogLine(PRODUCTION, PRODUCTION), 'catalog: production (prodprojectref.supabase.co)');
    const other = catalogLine(STAGING, PRODUCTION);
    assert.equal(other, 'catalog: NOT production (SUPABASE_URL is not prodprojectref.supabase.co, the top-level vars in wrangler.jsonc)');
    assert.ok(!other.includes('stagingprojectref'));
    assert.match(catalogLine(undefined, PRODUCTION), /^catalog: NOT production /);
});

const script = fileURLToPath(new URL('../scripts/check-fal-catalog.mjs', import.meta.url));
const run = (args, env) => spawnSync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

// Stops before the catalog or any fal page is fetched, so this needs no network.
test('with --require-production the script refuses a catalog that is not production', () => {
    for (const env of [{ SUPABASE_URL: 'https://some-other-project.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_test' }, {}]) {
        const out = run(['--require-production'], env);
        assert.equal(out.status, 1);
        const lines = out.stdout.trim().split('\n');
        assert.match(lines[0], /^catalog: NOT production \(SUPABASE_URL is not [a-z0-9]+\.supabase\.co, the top-level vars in wrangler\.jsonc\)$/);
        assert.match(lines.at(-1), /^FAIL: not the production catalog, so nothing was checked\./);
        assert.ok(!(out.stdout + out.stderr).includes('some-other-project'), 'the value it was given is printed');
    }
});

test('the weekly workflow requires the production catalog', () => {
    const workflow = readFileSync(new URL('../.github/workflows/fal-catalog-watch.yml', import.meta.url), 'utf8');
    assert.match(workflow, /node scripts\/check-fal-catalog\.mjs --require-production > report\.txt/);
});
