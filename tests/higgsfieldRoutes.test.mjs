import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicModelName } from '../lib/publicCatalog.js';

const sql = readFileSync('packages/db/schema/supabase/0437_higgsfield_standby_routes.sql', 'utf8');
test('migration stages exactly two unverified third routes at current promo costs and closes admission', () => {
    assert.match(sql, /\('kling-3\.0-i2v-kie', 'higgsfield:kling-video\/v3\.0\/pro\/image-to-video', 0\.2800::numeric\)/);
    assert.match(sql, /\('kling-2\.6-pro-kie', 'higgsfield:kling-video\/v2\.6\/pro\/text-to-video', 0\.1750::numeric\)/);
    assert.match(sql, /'per_second', 5, 3, 'standby', 'unverified'/);
    assert.match(sql, /VALUES \('higgsfield', false, 10000000, 25000000\)/);
    assert.match(sql, /IF n <> 2 THEN/);
    assert.match(sql, /IF n <> 1 THEN/);
    assert.match(sql, /DROP CONSTRAINT IF EXISTS model_routes_supplier_check/);
    assert.match(sql, /CHECK \(supplier IN \('fal', 'kie', 'grsai', 'byteplus', 'openrouter', 'crun', 'higgsfield'\)\)/);
    assert.match(sql, /ON CONFLICT \(model_id, priority\) DO NOTHING/);
    assert.match(sql, /ON CONFLICT \(provider\) DO NOTHING/);
    assert.match(sql, /BEGIN;[\s\S]*SET LOCAL search_path = '';[\s\S]*COMMIT;/);
});
test('migration changes no offer, activation or route order and records list margin consequences', () => {
    assert.doesNotMatch(sql, /state\s*=\s*'active'|UPDATE\s+public\.model_catalog|model_route_reorder|credits_5s/i);
    assert.match(sql, /2026-11-10/);
    assert.match(sql, /0\.5600 and 0\.3500/);
    assert.match(sql, /recorded margin waiver/);
    assert.ok(0.56 > 29 * 0.01796);
    assert.ok(0.35 > 18 * 0.01796);
});
test('customer names hide Higgsfield parentheticals and supplier suffixes', () => {
    for (const name of ['Kling 3.0 (Higgsfield)', 'Kling 3.0 via Higgsfield', 'Kling 3.0 — Higgsfield']) {
        assert.equal(publicModelName(name), 'Kling 3.0');
    }
});
