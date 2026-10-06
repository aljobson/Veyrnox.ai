import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGISTRY as CAPABILITIES } from '../lib/modelCapabilities.js';
import { TOOL_TASKS } from '../app/veyrnox/_lib/tools.js';

const sql = readFileSync(new URL('../packages/db/schema/supabase/0202_video_audio_and_upscale_staged.sql', import.meta.url), 'utf8');

test('both rows are staged inactive, never live (CLAUDE.md: verify against the live provider first)', () => {
  const rows = sql.split('\n').filter((l) => /^\s+\('(mmaudio-v2-video|topaz-upscale-video)'/.test(l));
  assert.equal(rows.length, 2);
  for (const r of rows) assert.match(r, /false, false\)[,;]?$/);
  assert.doesNotMatch(sql, /\bUPDATE\b/);
});

test('prices sit at or above the 50% floor: credits >= ceil(cost / 0.0165)', () => {
  assert.ok(1 >= Math.ceil(0.008 / 0.0165));
  assert.ok(49 >= Math.ceil(0.8 / 0.0165));
  assert.match(sql, /'mmaudio-v2-video'[^\n]*, 1, 0\.0080,/);
  assert.match(sql, /'topaz-upscale-video'[^\n]*, 49, 0\.8000,/);
});

test('video to audio pins the audio length and caps the source so cost is bounded', () => {
  const c = CAPABILITIES['fal-ai/mmaudio-v2'];
  assert.equal(c.fixed.duration, 8);
  assert.equal(c.media.video.maxSeconds, 8);
  assert.equal(c.media.video.required, true);
  assert.equal(c.inputs.prompt.required, true);
});

test('video upscale pins factor, fps and codec and caps the source length', () => {
  const c = CAPABILITIES['fal-ai/topaz/upscale/video'];
  assert.equal(c.fixed.upscale_factor, 2);
  assert.equal(c.fixed.target_fps, 30); // never the 60 fps doubled rate
  assert.equal(c.fixed.H264_output, true);
  assert.equal(c.media.video.maxSeconds, 10); // Topaz stays staged: its worst case is unmeasured (one billed run: $0.24)
});

test('the Tools page has a group for each new row', () => {
  const ids = TOOL_TASKS.flatMap((t) => t.ids);
  assert.ok(ids.includes('mmaudio-v2-video'));
  assert.ok(ids.includes('topaz-upscale-video'));
});

test('0221 activates MMAudio only, at the cost fal billed, and leaves Topaz staged exactly as 0202 applied it', () => {
  const act = readFileSync(new URL('../packages/db/schema/supabase/0221_activate_mmaudio_video_to_audio.sql', import.meta.url), 'utf8');
  assert.ok(1 >= Math.ceil(0.01 / 0.0165), 'one Credit still clears the 50% floor at the billed $0.0100');
  assert.match(act, /SET active = true, provider_cost_per_unit = 0\.0100/);
  assert.match(act, /AND active = false AND credits_5s = 1 AND provider_cost_per_unit = 0\.0080;/, 'pins the 0202 values, so an edited row fails loudly');
  assert.doesNotMatch(act, /topaz-upscale-video'\s+AND provider/, 'Topaz is not updated');
  assert.equal((act.match(/UPDATE public\.model_catalog/g) || []).length, 1, 'exactly one catalog UPDATE: MMAudio');
  assert.match(sql, /'topaz-upscale-video'[^\n]*, 49, 0\.8000,/, '0202 is already applied on production and is not edited');
});
