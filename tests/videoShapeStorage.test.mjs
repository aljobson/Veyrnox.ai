import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mixedShapes } from '../lib/videoShape.mjs';
import { patchSmartCutMetadataState } from '../app/veyrnox/_lib/smartCut.js';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const sql = read('../packages/db/schema/supabase/0577_video_shape_measurements.sql');
const previous = read('../packages/db/schema/supabase/0452_speech_analysis_readers.sql');
const reader = text => text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.list_user_jobs'), text.indexOf('TO service_role;', text.indexOf('CREATE OR REPLACE FUNCTION public.list_user_jobs')) + 'TO service_role;'.length);
test('hot list reader preserves 0452 verbatim except the three additive shape fields', () => {
    assert.equal(reader(sql).split('\n').filter(line => !/^\s+'(?:shape_ambiguous|video_width|video_height)',/.test(line)).join('\n'), reader(previous));
});
test('both RPCs pin canonical ownership, visibility, write-once storage and full privilege signatures', () => {
    for (const name of ['list_unmeasured_video_shapes', 'record_video_shape']) {
        const body = sql.slice(sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`), sql.indexOf('END $$;', sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)) + 7);
        for (const invariant of ['u.auth_id = p_auth_id', 'u.deleted_at IS NULL', "j.state = 'STORED'", 'j.deleted_at IS NULL', 'all_assets.job_id = j.id) = 1', "a.mime_type = 'video/mp4'", 'a.output_label IS NULL', 'a.held_at IS NULL', 'a.expires_at > pg_catalog.now()', 'a.shape_unreadable_at IS NULL']) assert.ok(body.includes(invariant), `${name}: ${invariant}`);
    }
    assert.match(sql, /REVOKE ALL ON FUNCTION public.list_unmeasured_video_shapes\(TEXT, UUID\[\]\) FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public.record_video_shape\(TEXT, UUID, TEXT, INTEGER, INTEGER\) TO service_role/);
    assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:jobs|ledger_entries|credit_balances)/i);
});
test('ambiguous web item stays excluded after live metadata and through undo snapshots', () => {
    const ambiguous = { uid: 'a', shape_ambiguous: true, ratio: null };
    const other = { uid: 'b', width: 1080, height: 1920 };
    const state = patchSmartCutMetadataState({ items: [ambiguous, other], smartCutSnapshot: [ambiguous, other], smartCutApplied: [ambiguous, other], editPast: [], editFuture: [] }, 'a', { ratio: '1.78', width: 1920, height: 1080, duration: 5 });
    assert.equal(state.items[0].width, 1920);
    assert.equal(mixedShapes(state.items), false);
    assert.equal(mixedShapes(state.smartCutSnapshot), false);
    assert.equal(mixedShapes([other, state.items[0]]), false);
});
