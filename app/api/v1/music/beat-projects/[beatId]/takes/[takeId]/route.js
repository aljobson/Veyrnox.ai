import { assertBeatMediaWritable, beatRoute, rpc, bodyOf, uuid, fail } from '../../../../../../../../lib/musicBeatCloudRoute.js';
import { envConfig, isConfigured, presignGetUrl, headObject, deleteObject } from '../../../../../../../../packages/adapters/r2.js';
async function read(request, context, params) {
  const ids = await params;
  const args = { p_beat_id: uuid(ids.beatId), p_take_id: uuid(ids.takeId) };
  const cfg = envConfig(); if (!isConfigured(cfg)) fail(503, 'storage_not_configured');
  return { args, cfg, take: await rpc(request, context, 'read_music_beat_take', args) };
}
export async function GET(request, { params }) {
  return beatRoute(request, async context => {
    const { take, cfg } = await read(request, context, params);
    if (take.status !== 'ready') fail(404, 'NOT_FOUND');
    const signed = await presignGetUrl(take.r2_key, 300, cfg);
    return Response.json({ url: signed.url, expires_in: signed.expires });
  });
}
export async function POST(request, { params }) {
  return beatRoute(request, async context => {
    await bodyOf(request, []);
    await assertBeatMediaWritable(request, context, uuid((await params).beatId));
    const { take, args, cfg } = await read(request, context, params);
    if (take.status === 'ready') return Response.json({ status: 'ready', idempotent: true });
    const head = await headObject(take.r2_key, cfg);
    if (!head.ok) fail(head.status === 404 ? 409 : 503, head.status === 404 ? 'take_upload_missing' : 'DATA_UNAVAILABLE');
    const header = head.response.headers.get('content-length');
    await head.response.body?.cancel();
    const measured = /^\d+$/.test(header || '') ? Number(header) : NaN;
    if (!Number.isSafeInteger(measured)) fail(503, 'DATA_UNAVAILABLE');
    try { return Response.json(await rpc(request, context, 'confirm_music_beat_take', { ...args, p_byte_size: measured })); }
    catch (error) {
      if (error.code !== 'SIZE_MISMATCH') throw error;
      await deleteObject(take.r2_key, cfg);
      fail(409, 'take_upload_invalid');
    }
  });
}
