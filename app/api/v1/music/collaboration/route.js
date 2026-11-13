import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicRpcStatus, publicMusicError } from '../../../../../lib/musicBackend.js';
import { musicCollaborationEnabled, parseMusicCollaboration, readMusicJson, validMusicAuthId } from '../../../../../lib/musicCollaboration.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function context(request) {
  const authId = request.headers.get('x-veyrnox-auth-id');
  if (!validMusicAuthId(authId)) return { response: reply({ error: 'not_authenticated' }, 401) };
  if (!musicCollaborationEnabled()) return { response: reply({ error: 'collaboration_unavailable' }, 404) };
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: reply({ error: 'gateway_not_configured' }, 503) };
  return { authId, cfg };
}
export async function GET(request) {
  const current = context(request); if (current.response) return current.response;
  try {
    const result = await rpc('music_read_collaboration', { p_auth_id: current.authId }, current.cfg);
    return result?.ok ? reply({ profile: result.profile, invitations: result.invitations, workspaces: result.workspaces }) : reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
  } catch (error) { console.error('[music/collaboration] read failed:', error?.message); return reply({ error: 'temporarily_unavailable' }, 502); }
}
export async function POST(request) {
  const current = context(request); if (current.response) return current.response;
  const decoded = await readMusicJson(request); if (!decoded.ok) return reply({ error: decoded.error }, 400);
  const input = parseMusicCollaboration(decoded.value); if (!input.ok) return reply({ error: input.error }, 400);
  const calls = {
    profile: ['music_set_collaboration_profile', { p_auth_id: current.authId, p_handle: input.handle, p_display_name: input.displayName }],
    invite: ['music_invite_workspace', { p_auth_id: current.authId, p_workspace_id: input.workspaceId, p_handle: input.handle, p_idempotency_key: input.idempotencyKey }],
    respond: ['music_respond_workspace_invite', { p_auth_id: current.authId, p_invitation_id: input.invitationId, p_decision: input.decision, p_idempotency_key: input.idempotencyKey }],
  };
  try {
    const [name, args] = calls[input.action]; const result = await rpc(name, args, current.cfg);
    return result?.ok ? reply(result) : reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
  } catch (error) { console.error('[music/collaboration] mutation failed:', error?.message); return reply({ error: 'temporarily_unavailable' }, 502); }
}
