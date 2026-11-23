import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicAlbumsEnabled, musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { parseAlbumReport, validAlbumSlug } from '../../../../../lib/musicAlbums.js';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request){const auth=request.headers.get('x-veyrnox-auth-id');if(!validMusicAuthId(auth))return reply({error:'not_authenticated'},401);
    if(!musicAlbumsEnabled())return reply({error:'albums_unavailable'},404);const cfg=envConfig();if(!cfg.supabaseUrl||!cfg.serviceRoleKey)return reply({error:'gateway_not_configured'},503);
    const body=await readMusicJson(request);if(!body.ok||!body.value||typeof body.value!=='object'||Array.isArray(body.value))return reply({error:body.ok?'invalid_request':body.error},400);
    if(Object.keys(body.value).sort().join(',')!==['category','details','idempotency_key','slug'].sort().join(','))return reply({error:'invalid_request'},400);
    if(!validAlbumSlug(body.value.slug))return reply({error:'slug_invalid'},400);
    const input=parseAlbumReport({category:body.value.category,details:body.value.details,idempotency_key:body.value.idempotency_key});if(!input.ok)return reply({error:input.error},400);
    try{const result=await rpc('music_report_album',{p_auth_id:auth,p_slug:body.value.slug,p_category:input.category,p_details:input.details,p_key:input.idempotencyKey},cfg);
        if(!result?.ok)return reply({error:publicMusicError(result?.code)},musicRpcStatus(result?.code));return reply({status:'reported',idempotent:result.idempotent===true});
    }catch{return reply({error:'temporarily_unavailable'},502);}}
