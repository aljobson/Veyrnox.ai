import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { productionUrl } from '../scripts/lib/catalog-target.mjs';

// The real script, start to finish, with the network replaced by
// tests/fixtures/fal-watch-fetch.mjs: two catalog rows and their two pages.
const script = fileURLToPath(new URL('../scripts/check-fal-catalog.mjs', import.meta.url));
const stub = new URL('./fixtures/fal-watch-fetch.mjs', import.meta.url).href;
const PRODUCTION = productionUrl(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

const BRIA = 'fal-ai/bria/expand';
const SEEDREAM = 'fal-ai/bytedance/seedream/v4/text-to-image';
const row = (id, provider_endpoint, credits_5s, provider_cost_per_unit) => ({
    id, provider: 'fal', provider_endpoint, credits_5s, provider_cost_per_unit, cost_unit: 'per_generation', billing_seconds: null, active: true,
});
const rows = [row('bria-expand', BRIA, 3, 0.04), row('seedream-4', SEEDREAM, 2, 0.03)];
const billing = (endpoint, unit, price) => String.raw`\"endpointBilling\":{\"endpoint\":\"${endpoint}\",\"billing_unit\":\"${unit}\",\"price\":${price},\"provider_type\":\"partner\"},\"isAdmin\":false`;
const BRIA_PAGE = `Your request will cost **$0.04** per image.${billing(BRIA, 'generations', 0.04)}`;
// Seedream's page has no "$" figure of its own.
const seedream = (price, extra = '') => `${extra}<p>Seedream 4.0</p>${billing(SEEDREAM, 'images', price)}`;

function run({ url = PRODUCTION, mode = 'false', args = ['--require-production'], seedreamPage = seedream(0.03) } = {}) {
    const out = spawnSync(process.execPath, ['--import', stub, script, ...args], {
        env: {
            PATH: process.env.PATH,
            SUPABASE_URL: url,
            SUPABASE_ANON_KEY: 'sb_publishable_test',
            FAL_DRIFT_FAILS: mode,
            FAL_WATCH_STUB: JSON.stringify({ rows, pages: { [BRIA]: BRIA_PAGE, [SEEDREAM]: seedreamPage } }),
        },
        encoding: 'utf8',
    });
    return { status: out.status, lines: out.stdout.trimEnd().split('\n'), all: out.stdout + out.stderr };
}

test('the production catalog is named on the first line and every row is compared', () => {
    const out = run();
    assert.equal(out.status, 0, out.all);
    assert.deepEqual(out.lines, [
        `catalog: production (${new URL(PRODUCTION).host})`,
        'ok    bria-expand          $0.0400 per generation 3cr  margin 59.6%',
        'ok    seedream-4           $0.0300 per generation 2cr  margin 54.5%',
        '',
        "base prices: 2 of 2 match fal's billing",
        '',
        'clean (0 drift notes, 0 cost notes)',
    ]);
});

test('a base price that moved is a note until the switch is on, then it fails the run', () => {
    const noted = run({ seedreamPage: seedream(0.035) });
    assert.equal(noted.status, 0, noted.all);
    assert.deepEqual(noted.lines.slice(2), [
        "DRIFT? seedream-4           expect base price $0.03/images  fal's billing: $0.035/images",
        '',
        "base prices: 1 of 2 match fal's billing, 1 moved",
        '',
        '## Possible price drift (1) — verify by hand',
        "- `seedream-4` expected base price $0.03/images, fal's billing: $0.035/images",
        '',
        'clean (1 drift note, 0 cost notes)',
    ]);
    for (const mode of ['listed', 'all']) {
        const failed = run({ mode, seedreamPage: seedream(0.035) });
        assert.equal(failed.status, 1, mode);
        assert.equal(failed.lines.at(-1), 'FAIL: 0 dead, 0 breach, 1 drift, 0 cost');
    }
});

// The stray "$4.2" every fal page carried on 2026-09-14, 09-21 and 09-28.
test("a stray figure on a page with no price of its own fails only under 'all'", () => {
    const stray = seedream(0.03, '<span>$4.2</span>');
    const listed = run({ mode: 'listed', seedreamPage: stray });
    assert.equal(listed.status, 0, listed.all);
    assert.ok(listed.lines.includes('DRIFT? seedream-4           expect $0.0300 per generation  page: $4.2'));
    assert.ok(listed.lines.includes("base prices: 2 of 2 match fal's billing"));
    assert.equal(listed.lines.at(-1), 'clean (1 drift note, 0 cost notes)');
    assert.equal(run({ mode: 'all', seedreamPage: stray }).status, 1);
});

test('without the flag another catalog is still read, and the first line says it is not production', () => {
    const out = run({ url: 'https://some-other-project.supabase.co', args: [] });
    assert.equal(out.status, 0, out.all);
    assert.match(out.lines[0], /^catalog: NOT production \(SUPABASE_URL is not /);
    assert.equal(out.lines[1], 'ok    bria-expand          $0.0400 per generation 3cr  margin 59.6%');
    assert.equal(out.lines.at(-1), 'clean (0 drift notes, 0 cost notes)');
    assert.ok(!out.all.includes('some-other-project'), 'the value it was given is printed');
});

test('with the flag another catalog is refused before a row is read', () => {
    const out = run({ url: 'https://some-other-project.supabase.co' });
    assert.equal(out.status, 1);
    assert.equal(out.lines.length, 2);
    assert.match(out.lines[1], /^FAIL: not the production catalog, so nothing was checked\./);
});
