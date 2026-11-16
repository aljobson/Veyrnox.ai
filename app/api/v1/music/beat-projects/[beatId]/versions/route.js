import { beatRoute, tenant, projectRow, uuid, VERSION_FIELDS } from '../../../../../../../lib/musicBeatCloudRoute.js';
export async function GET(request, { params }) {
  return beatRoute(request, async context => {
    const project = await projectRow(request, context, uuid((await params).beatId));
    return Response.json({ versions: await tenant(request, context,
      `music_beat_project_versions?select=${VERSION_FIELDS}&project_id=eq.${encodeURIComponent(project.id)}&order=saved_at.desc,revision.desc,id.desc&limit=20`) });
  });
}
