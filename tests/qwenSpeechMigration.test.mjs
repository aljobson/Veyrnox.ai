import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromFallback } from '../app/veyrnox/_lib/useCatalog.js';
import { sniffProviderOutputType } from '../lib/providerOutputType.js';
const sql = readFileSync(new URL('../packages/db/schema/supabase/0590_crun_qwen3_tts_speech.sql', import.meta.url), 'utf8');
test('Qwen migration stages both catalog and sweep route idempotently and asserts their exact states', () => {
    assert.match(sql, /'text-to-speech', 2, 0\.0089, 'per_generation', NULL, false, false/);
    assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
    assert.match(sql, /ON CONFLICT \(model_id, supplier, endpoint\) DO NOTHING/);
    assert.match(sql, /'qwen3-tts', 'crun', 'crun:qwen3-tts\/speech-synthesis', 0\.0089, 'per_generation', NULL, 1, 'standby', 'licensed_reseller'/);
    assert.equal((sql.match(/IF affected <> 1 THEN/g) || []).length, 2);
    assert.equal((sql.match(/RAISE EXCEPTION/g) || []).length, 2);
    assert.match(sql, /active = false/);
    assert.match(sql, /state = 'standby' AND provenance = 'licensed_reseller'/);
    assert.doesNotMatch(sql, /UPDATE public\.|CREATE (?:TABLE|FUNCTION)/i);
    assert.ok(0.0089 <= 2 * 0.01796, 'catalog margin floor');
});
test('inactive Qwen stays out of fallback catalogs and WAV bytes retain their media type', () => {
    assert.equal(fromFallback().some(model => model.id === 'qwen3-tts'), false);
    const wav = Buffer.alloc(44); wav.write('RIFF'); wav.writeUInt32LE(36, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
    assert.equal(sniffProviderOutputType(wav), 'audio/wav');
});
