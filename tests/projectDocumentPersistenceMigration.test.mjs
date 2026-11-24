import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../packages/db/schema/supabase/0615_project_document_editor_parity.sql', import.meta.url), 'utf8');

test('project document parity migration admits every new bounded editor field', () => {
    assert.match(sql, /'16:9','9:16','1:1','4:5'/);
    assert.match(sql, /\^custom:\(\[1-9\]\[0-9\]\{0,2\}\)x/);
    assert.match(sql, /generate_series\(2,least\(width,height\)\)/);
    assert.match(sql, /project_cover_within_bounds/);
    assert.match(sql, /project_editing_summary_within_bounds/);
    assert.match(sql, /'timeline','cover','editing_summary'/);
    assert.match(sql, /private\.project_document_within_bounds\(content,project\)/);
    assert.match(sql, /project_editor_timeline_within_bounds/);
    assert.match(sql, /jsonb_set\(value,'\{aspect\}','"1:1"'::jsonb,false\)/);
    assert.match(sql, /private\.project_oddlings_within_bounds/);
    assert.match(sql, /COMMIT;\s*$/);
});

test('the previously deployed document migration remains immutable', () => {
    const prior = readFileSync(new URL('../packages/db/schema/supabase/0361_project_document_oddlings.sql', import.meta.url), 'utf8');
    assert.doesNotMatch(prior, /4:5|custom:|editing_summary|project_cover_within_bounds/);
});
