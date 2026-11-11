import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMusicCrop, parseMusicLocalRender } from '../lib/musicEditing.js';

const migrationUrl=new URL('../packages/db/schema/supabase/0464_music_nondestructive_crop.sql',import.meta.url);
const renderMigrationUrl=new URL('../packages/db/schema/supabase/0472_music_canonical_wav_crop.sql',import.meta.url);
const localRenderMigrationUrl=new URL('../packages/db/schema/supabase/0473_music_local_wav_edits.sql',import.meta.url);
const reorderMigrationUrl=new URL('../packages/db/schema/supabase/0485_music_reorder_sections.sql',import.meta.url);
const remasterMigrationUrl=new URL('../packages/db/schema/supabase/0486_music_pcm_remaster.sql',import.meta.url);
const routeUrl=new URL('../app/api/v1/music/songs/[id]/crop/route.js',import.meta.url);
const localRenderRouteUrl=new URL('../app/api/v1/music/songs/[id]/render/route.js',import.meta.url);
const exportUrl=new URL('../app/api/v1/music/songs/[id]/export-quotes/route.js',import.meta.url);
test('crop parser accepts one bounded exact range and rejects ambiguous shapes',()=>{
  const value={version_id:'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b',start_seconds:1.25,end_seconds:9.5,idempotency_key:'crop.12345678'};
  assert.deepEqual(parseMusicCrop(value),{ok:true,versionId:value.version_id,start:1.25,end:9.5,idempotencyKey:'crop.12345678'});
  assert.equal(parseMusicCrop({...value,end_seconds:1.5}).error,'crop_too_short');
  assert.equal(parseMusicCrop({...value,overwrite:true}).error,'invalid_request');
});
test('local render parser accepts exact fade, speed, two-section reorder and remaster contracts only',()=>{
  const version_id='a5ed2d0d-8276-4fbb-9c4f-39f401a3158b',idempotency_key='render.12345678';
  assert.deepEqual(parseMusicLocalRender({operation:'fade',version_id,fade_in_seconds:1.5,fade_out_seconds:2,idempotency_key}),{
    ok:true,operation:'fade',versionId:version_id,parameters:{fade_in_seconds:1.5,fade_out_seconds:2},idempotencyKey:idempotency_key,
  });
  assert.deepEqual(parseMusicLocalRender({operation:'speed',version_id,speed_ratio:1.25,idempotency_key}),{
    ok:true,operation:'speed',versionId:version_id,parameters:{speed_ratio:1.25},idempotencyKey:idempotency_key,
  });
  assert.deepEqual(parseMusicLocalRender({operation:'reorder',version_id,split_seconds:12.5,order:[2,1],idempotency_key}),{
    ok:true,operation:'reorder',versionId:version_id,parameters:{split_seconds:12.5,order:[2,1]},idempotencyKey:idempotency_key,
  });
  assert.deepEqual(parseMusicLocalRender({operation:'remaster',version_id,target_peak_dbfs:-2,idempotency_key}),{
    ok:true,operation:'remaster',versionId:version_id,parameters:{target_peak_dbfs:-2},idempotencyKey:idempotency_key,
  });
  assert.equal(parseMusicLocalRender({operation:'fade',version_id,fade_in_seconds:0,fade_out_seconds:0,idempotency_key}).error,'fade_range_invalid');
  assert.equal(parseMusicLocalRender({operation:'speed',version_id,speed_ratio:3,idempotency_key}).error,'speed_ratio_invalid');
  assert.equal(parseMusicLocalRender({operation:'speed',version_id,speed_ratio:1,idempotency_key}).error,'speed_ratio_invalid');
  assert.equal(parseMusicLocalRender({operation:'speed',version_id,speed_ratio:1,idempotency_key,overwrite:true}).error,'invalid_request');
  assert.equal(parseMusicLocalRender({operation:'reorder',version_id,split_seconds:0.5,order:[2,1],idempotency_key}).error,'reorder_range_invalid');
  assert.equal(parseMusicLocalRender({operation:'reorder',version_id,split_seconds:12.5,order:[1,2],idempotency_key}).error,'reorder_range_invalid');
  assert.equal(parseMusicLocalRender({operation:'remaster',version_id,target_peak_dbfs:-0.5,idempotency_key}).error,'remaster_target_invalid');
  assert.equal(parseMusicLocalRender({operation:'remaster',version_id,target_peak_dbfs:-2,idempotency_key,compression:true}).error,'invalid_request');
});
test('remaster is a canonical no-credit replay-safe child with bounded level-only disclosure',async()=>{
  const [route,sql,dialog]=await Promise.all([
    readFile(localRenderRouteUrl,'utf8'),readFile(remasterMigrationUrl,'utf8'),
    readFile(new URL('../app/veyrnox/_components/music/MusicRenderDialog.jsx',import.meta.url),'utf8'),
  ]);
  assert.match(route,/renderPcmWavRemaster/);
  assert.match(sql,/'music-local-remaster'/);
  assert.match(sql,/CHECK \(operation IN \('crop','fade','speed','reorder','remaster'\)\)/);
  assert.match(sql,/v_target_peak NOT IN \(-3,-2,-1\)/);
  assert.match(sql,/'pcm-wav-remaster-v1'/);
  assert.match(sql,/UPDATE public\.music_songs SET current_version_id=p_output_version_id/);
  assert.match(dialog,/removes channel DC bias and applies linked peak normalization without inventing spectral detail/);
  assert.match(dialog,/not AI mastering, compression, EQ, or loudness matching/);
});
test('fade and speed render distinct canonical WAV assets with replay-safe immutable lineage',async()=>{
  const [route,sql]=await Promise.all([readFile(localRenderRouteUrl,'utf8'),readFile(localRenderMigrationUrl,'utf8')]);
  assert.match(route,/renderPcmWavFade/);
  assert.match(route,/renderPcmWavSpeed/);
  assert.match(route,/music_get_local_render_context/);
  assert.match(route,/music_commit_local_wav_render/);
  assert.match(route,/putObject\(outputKey, rendered\.bytes, 'audio\/wav'/);
  assert.match(sql,/model_id IN \('music-local-crop','music-local-fade','music-local-speed'\)/);
  assert.match(sql,/CHECK \(operation IN \('crop','fade','speed'\)\)/);
  assert.match(sql,/INSERT INTO public\.music_version_sources[\s\S]*'edit_source'/);
  assert.match(sql,/INSERT INTO public\.music_version_operation_receipts/);
  assert.match(sql,/UPDATE public\.music_songs SET current_version_id=p_output_version_id/);
  assert.match(sql,/v_receipt\.parameters IS DISTINCT FROM p_parameters/);
});
test('two-section reorder is a canonical replay-safe child with exact split and fixed swap order',async()=>{
  const [route,sql]=await Promise.all([readFile(localRenderRouteUrl,'utf8'),readFile(reorderMigrationUrl,'utf8')]);
  assert.match(route,/renderPcmWavReorder/);
  assert.match(route,/input\.parameters\.split_seconds > inspected\.seconds - 1/);
  assert.match(sql,/music-local-reorder/);
  assert.match(sql,/p_operation IS DISTINCT FROM 'reorder'/);
  assert.match(sql,/p_parameters->'order' IS DISTINCT FROM '\[2,1\]'::jsonb/);
  assert.match(sql,/abs\(p_output_duration-p_source_duration\)>0\.05/);
  assert.match(sql,/INSERT INTO public\.music_version_sources[\s\S]*'edit_source'/);
  assert.match(sql,/UPDATE public\.music_songs SET current_version_id=p_output_version_id/);
});
test('crop creates an immutable child and durable source edge without overwriting audio',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  assert.match(sql,/VALUES\(v_user,'crop',p_source_version_id/);
  assert.match(sql,/INSERT INTO public\.music_version_sources[\s\S]*'edit_source'/);
  assert.match(sql,/UPDATE public\.music_songs SET current_version_id=p_output_version_id/);
  assert.match(sql,/render_state','preview_only'/);
  assert.match(sql,/UNIQUE\(user_id,idempotency_key\)/);
});
test('crop duration is measured from stored bytes and only canonical versions can export',async()=>{
  const [route,exportRoute,renderSql]=await Promise.all([readFile(routeUrl,'utf8'),readFile(exportUrl,'utf8'),readFile(renderMigrationUrl,'utf8')]);
  assert.match(route,/inspectStoredSource\(context\.r2_key/);
  assert.match(route,/input\.end>inspected\.seconds\+0\.05/);
  assert.match(route,/renderPcmWavCrop\(source,input\.start,input\.end\)/);
  assert.match(route,/putObject\(outputKey,rendered\.bytes,'audio\/wav'/);
  assert.match(route,/music_commit_rendered_wav_crop/);
  assert.match(exportRoute,/music_get_version_exportability/);
  assert.match(exportRoute,/render_required/);
  assert.match(renderSql,/credits = 0 AND model_id = 'music-local-crop'/);
  assert.match(renderSql,/INSERT INTO public\.jobs/);
  assert.match(renderSql,/INSERT INTO public\.assets/);
  assert.match(renderSql,/'render_state','canonical'/);
  assert.match(renderSql,/v\.provenance->>'render_state'='canonical'/);
  assert.match(renderSql,/WHERE user_id=v_user AND idempotency_key=p_idempotency_key/);
});
