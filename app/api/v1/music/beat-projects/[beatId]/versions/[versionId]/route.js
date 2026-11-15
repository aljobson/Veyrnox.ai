import { beatRoute, tenant, projectRow, uuid, VERSION_FIELDS, BEAT_READ_BYTES, fail } from '../../../../../../../../lib/musicBeatCloudRoute.js';
export async function GET(request, { params }) {
  return beatRoute(request, async context => {
    const ids = await params, project = await projectRow(request, context, uuid(ids.beatId));
    const rows = await tenant(request, context,
      `music_beat_project_versions?select=${VERSION_FIELDS},doc_json&project_id=eq.${encodeURIComponent(project.id)}&id=eq.${encodeURIComponent(uuid(ids.versionId))}&limit=1`, { maxBytes: BEAT_READ_BYTES });
    if (!rows[0]) fail(404, 'NOT_FOUND');
    const { doc_json, ...version } = rows[0];
    return Response.json({ version, doc_json });
  });
}
