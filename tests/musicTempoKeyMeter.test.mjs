import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMusicQuote } from '../lib/musicBackend.js';
import { MUSIC_KEY_SCALES, parseMusicTempoControls } from '../lib/musicTempoControls.js';

// Tempo, key and time signature for ACE-Step 1.5 (0514) map to fal's documented
// bpm, key_scale and time_signature inputs. Absent = the provider chooses.

const base = { mode: 'simple', prompt: 'warm lo-fi guitar loop', model_id: 'ace-step-1.5', duration_seconds: 30 };

test('valid tempo, key and meter reach the quote input', () => {
    const r = parseMusicQuote({ ...base, bpm: 96, key_scale: 'A Minor', time_signature: '3' });
    assert.equal(r.ok, true);
    assert.equal(r.bpm, 96);
    assert.equal(r.keyScale, 'A Minor');
    assert.equal(r.timeSignature, '3');
});

test('leaving them out keeps the provider default', () => {
    const r = parseMusicQuote(base);
    assert.equal(r.ok, true);
    assert.deepEqual([r.bpm, r.keyScale, r.timeSignature], [null, null, null]);
});

test('the base model refuses them', () => {
    assert.equal(parseMusicQuote({ ...base, model_id: 'ace-step', bpm: 96 }).error, 'advanced_controls_invalid');
});

test('out-of-range or unknown values are refused', () => {
    assert.equal(parseMusicTempoControls({ bpm: 39 }).error, 'bpm_invalid');
    assert.equal(parseMusicTempoControls({ bpm: 221 }).error, 'bpm_invalid');
    assert.equal(parseMusicTempoControls({ bpm: 96.5 }).error, 'bpm_invalid');
    assert.equal(parseMusicTempoControls({ key_scale: 'H Major' }).error, 'key_scale_invalid');
    assert.equal(parseMusicTempoControls({ key_scale: 'Am' }).error, 'key_scale_invalid');
    assert.equal(parseMusicTempoControls({ time_signature: '5' }).error, 'time_signature_invalid');
});

test('the SQL check accepts exactly the keys the form offers', () => {
    const sql = readFileSync(new URL('../packages/db/schema/supabase/0514_music_tempo_key_meter.sql', import.meta.url), 'utf8');
    const re = new RegExp(sql.match(/key_scale ~ '([^']+)'/)[1]);
    assert.equal(MUSIC_KEY_SCALES.length, 24);
    for (const key of MUSIC_KEY_SCALES) assert.match(key, re);
    assert.doesNotMatch('Db Major', re);
    assert.match(sql, /'bpm', v_spec\.bpm/);
    assert.match(sql, /'key_scale', v_spec\.key_scale/);
    assert.match(sql, /'time_signature', v_spec\.time_signature/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.music_create_quote\(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,INTEGER,TEXT,TEXT\) TO service_role/);
});

test('the quote route sends them only when used, so an unapplied 0514 cannot break a plain quote', () => {
    const route = readFileSync(new URL('../app/api/v1/music/generation-quotes/route.js', import.meta.url), 'utf8');
    assert.match(route, /input\.bpm !== null \|\| input\.keyScale !== null \|\| input\.timeSignature !== null \? \{/);
});
