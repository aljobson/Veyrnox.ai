import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCatalogUpdates } from '../scripts/check-catalog-update-guards.mjs';

const name = '0358_kie_cheap_skus_staged.sql';
const sql = readFileSync(new URL(`../packages/db/schema/supabase/${name}`, import.meta.url), 'utf8');
const rows = [
    ['kling-3.0-i2v-720p-kie', 'market:kling-3.0/video-std', 22, '0.3500', 'per_second', '5::numeric', 20],
    ['seedance-2.0-mini-kie', 'market:bytedance/seedance-2-mini', 13, '0.2050', 'per_second', '5::numeric', 12],
    ['wan-2.6-flash-i2v-kie', 'market:wan/2-6-flash-image-to-video', 7, '0.1000', 'per_generation', 'NULL::numeric', 6],
    ['seedream-5-flash-kie', 'market:seedream/5-flash-text-to-image', 1, '0.0162', 'per_generation', 'NULL::numeric', 1],
];

test('staged migration stores totals and exact credit floors with no catalog UPDATE', () => {
    assert.deepEqual(checkCatalogUpdates(sql, name), []);
    assert.doesNotMatch(sql, /\bUPDATE\b/i);
    assert.match(sql, /ON CONFLICT \(id\) DO NOTHING\s+RETURNING \* INTO inserted/);
    assert.match(sql, /candidate\.billing_seconds, false, false/);
    for (const [id, endpoint, credits, cost, unit, seconds, floor] of rows) {
        const line = sql.split('\n').find(line => line.includes(`('${id}'`));
        assert.ok(line.includes(`'${endpoint}'`));
        assert.ok(line.includes(`${credits}, ${cost}, '${unit}', ${seconds}`));
        assert.equal(Math.ceil(Number(cost) / 0.01796), floor);
        assert.ok(credits >= floor);
    }
});

test('only freshly inserted rows assert price/state; conflicts check identity alone', () => {
    const fresh = sql.slice(sql.indexOf('IF FOUND THEN'), sql.indexOf('SELECT id, provider'));
    for (const key of ['active', 'gated_flag', 'credits_5s', 'provider_cost_per_unit', 'cost_unit', 'billing_seconds']) assert.ok(fresh.includes(`inserted.${key}`));
    assert.match(fresh, /reservation IS DISTINCT FROM candidate\.cost/);
    const conflicts = sql.slice(sql.indexOf('SELECT id, provider'));
    assert.match(conflicts, /provider IS DISTINCT FROM 'kie'/);
    assert.match(conflicts, /provider_endpoint IS DISTINCT FROM candidate\.endpoint/);
    assert.match(conflicts, /modality IS DISTINCT FROM candidate\.modality/);
    assert.doesNotMatch(conflicts, /active|credits_5s|provider_cost_per_unit|gated_flag|billing_seconds|cost_unit/);
});
