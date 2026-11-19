import { assertBeatMediaWritable, beatRoute, tenant, rpc, bodyOf, projectRow, uuid, fail } from '../../../../../../../lib/musicBeatCloudRoute.js';
import { envConfig, isConfigured, presignPutUrl } from '../../../../../../../packages/adapters/r2.js';
export async function GET(request, { params }) {
  return beatRoute(request, async context => {
    const project = await projectRow(request, context, uuid((await params).beatId));
    return Response.json({ takes: await tenant(request, context,
      `music_beat_project_takes?select=take_ref,id,status,byte_size,duration_sec&project_id=eq.${encodeURIComponent(project.id)}&limit=64`) });
  });
}
export async function POST(request, { params }) {
  return beatRoute(request, async context => {
    const beatId = uuid((await params).beatId), body = await bodyOf(request, ['take_ref', 'byte_size', 'duration_sec']);
    if (typeof body.take_ref !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.take_ref) ||
      !Number.isSafeInteger(body.byte_size) || body.byte_size < 44 || body.byte_size > 60000000 ||
      !Number.isFinite(body.duration_sec) || body.duration_sec <= 0 || body.duration_sec > 600) fail(400, 'INVALID_REQUEST');
    await assertBeatMediaWritable(request, context, beatId);
    const cfg = envConfig(); if (!isConfigured(cfg)) fail(503, 'storage_not_configured');
    const take = await rpc(request, context, 'reserve_music_beat_take', { p_beat_id: beatId, p_take_ref: body.take_ref, p_byte_size: body.byte_size, p_duration_sec: body.duration_sec });
    if (take.status === 'ready') return Response.json({ take_id: take.take_id, status: 'ready' });
    // Subtract clock/transport margin. Never let the adapter's minimum TTL exceed the recorded deadline.
    const ttl = Math.min(890, Math.floor((Date.parse(take.upload_expires_at) - Date.now()) / 1000) - 5);
    if (!Number.isFinite(ttl) || ttl < 60) fail(503, 'DATA_UNAVAILABLE');
    const signed = await presignPutUrl(take.r2_key, 'audio/wav', ttl, cfg, Number(take.byte_size));
    return Response.json({ take_id: take.take_id, status: 'pending', upload_url: signed.url,
      upload_headers: { 'Content-Type': 'audio/wav', 'If-None-Match': '*' }, upload_expires_in: signed.expires });
  });
}
