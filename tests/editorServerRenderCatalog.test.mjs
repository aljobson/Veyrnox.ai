import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The provider spend guard (0327, 0329) refuses a job whose catalog provider cost is zero,
// which made every production admission fail with a database error (found 2026-10-26).
const sql = name => readFileSync(new URL(`../packages/db/schema/supabase/${name}`, import.meta.url), 'utf8');

test('server render catalog row ends with a positive provider cost, guarded by a row count', () => {
    const insert = sql('0396_editor_server_render.sql');
    assert.match(insert, /VALUES\('editor-server-render','Editor server render','concat-render','concat-render:v1','video-to-video',1,0,/);
    const fix = sql('0400_editor_server_render_provider_cost.sql');
    const cost = fix.match(/provider_cost_per_unit\s*=\s*([0-9.]+)/);
    assert.ok(cost && Number(cost[1]) > 0, 'a later migration must set a positive provider_cost_per_unit');
    assert.match(fix, /id = 'editor-server-render' AND provider = 'concat-render'/);
    assert.match(fix, /GET DIAGNOSTICS affected = ROW_COUNT;\s*IF affected <> 1 THEN/);
});
