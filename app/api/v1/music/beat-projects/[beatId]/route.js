import { BEAT_WRITE_VERSION } from '../../../../../veyrnox/_lib/music/beat/beatCompatibility.mjs';
import { beatRoute, bodyOf, revision, rpc, projectRow, uuid, fail } from '../../../../../../lib/musicBeatCloudRoute.js';
import { idempotencyKey } from '../../../../../../packages/security/input.js';
import { validateBeat } from '../../../../../veyrnox/_lib/music/beat/beatDocument.mjs';
export async function GET(request, { params }) {
  return beatRoute(request, async context => {
    const { doc_json, ...project } = await projectRow(request, context, uuid((await params).beatId), true);
    return Response.json({ project, doc_json });
  });
}
export async function PUT(request, { params }) {
  return beatRoute(request, async context => {
    const beatId = uuid((await params).beatId);
    const body = await bodyOf(request, ['expected_revision', 'doc_json', 'mode'], undefined, ['client_beat_version']);
    revision(body.expected_revision);
    let doc;
    try { doc = JSON.parse(body.doc_json); } catch { fail(400, 'INVALID_BEAT'); }
    if (typeof body.doc_json !== 'string' || new TextEncoder().encode(body.doc_json).length > 262144 ||
        !validateBeat(doc).ok || doc.id !== beatId || !['autosave', 'checkpoint', 'stash'].includes(body.mode)) fail(400, 'INVALID_BEAT');
    if (doc.version > BEAT_WRITE_VERSION) fail(409, 'BEAT_CLIENT_OUTDATED');
    const project = await rpc(request, context, 'save_music_beat_project', { p_beat_id: beatId,
      p_expected_revision: body.expected_revision, p_doc: body.doc_json, p_title: doc.title,
      p_client_beat_version: clientVersion(body), p_mode: body.mode, p_idempotency_key: idempotencyKey(request) });
    return Response.json({ project }, { status: body.expected_revision === 0 && !project.idempotent ? 201 : 200 });
  });
}
export async function DELETE(request, { params }) {
  return beatRoute(request, async context => {
    const beatId = uuid((await params).beatId), body = await bodyOf(request, ['expected_revision'], undefined, ['client_beat_version']);
    return Response.json(await rpc(request, context, 'remove_music_beat_project', { p_beat_id: beatId, p_client_beat_version: clientVersion(body), p_expected_revision: revision(body.expected_revision, 1) }));
  });
}

function clientVersion(body) {
  const version = Object.hasOwn(body, 'client_beat_version') ? body.client_beat_version : 4;
  if (!Number.isSafeInteger(version) || version < 1 || version > 5) fail(400, 'INVALID_BEAT_CLIENT_VERSION');
  return version;
}
