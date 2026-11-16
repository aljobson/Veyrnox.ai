import { beatRoute, tenant, PROJECT_FIELDS } from '../../../../../lib/musicBeatCloudRoute.js';
export async function GET(request) {
  return beatRoute(request, async context => Response.json({ projects: await tenant(request, context,
    `music_beat_projects?select=${PROJECT_FIELDS}&order=updated_at.desc&limit=50`) }));
}
