import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../packages/db/schema/supabase/0610_editor_render_4k60.sql', import.meta.url), 'utf8');

test('4K migration keeps API, admission, upload and settlement limits in one transaction', () => {
    assert.match(sql, /^-- F070:[\s\S]*\nBEGIN;/);
    assert.match(sql, /WHEN '2160p' THEN 30/);
    assert.match(sql, /WHEN p_resolution='2160p' THEN 104857600 ELSE 26214400 END/);
    assert.match(sql, /WHEN j\.inputs->>'resolution'='2160p' THEN 104857600 ELSE 26214400 END/);
    assert.match(sql, /expected_rate NOT IN \(24,25,30,60\)/);
    assert.match(sql, /p_width IS DISTINCT FROM expected_width OR p_height IS DISTINCT FROM expected_height/);
    assert.match(sql, /p_frame_rate IS DISTINCT FROM expected_rate/);
    assert.match(sql, /GRANT EXECUTE[\s\S]*TO service_role;/);
    assert.match(sql, /COMMIT;\s*$/);
});
