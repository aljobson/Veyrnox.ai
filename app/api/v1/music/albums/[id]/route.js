import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { musicAlbumsEnabled, musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../../lib/musicBackend.js';
import { parseAlbumPatch } from '../../../../../../lib/musicAlbums.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function PATCH(request,{params}){
    const auth=request.headers.get('x-veyrnox-auth-id'),{id}=await params;if(!validMusicAuthId(auth))return reply({error:'not_authenticated'},401);
    if(!musicAlbumsEnabled())return reply({error:'albums_unavailable'},404);if(!UUID.test(id||''))return reply({error:'album_id_invalid'},400);
    const cfg=envConfig();if(!cfg.supabaseUrl||!cfg.serviceRoleKey)return reply({error:'gateway_not_configured'},503);
    const body=await readMusicJson(request);if(!body.ok)return reply({error:body.error},400);const input=parseAlbumPatch(body.value);if(!input.ok)return reply({error:input.error},400);
    try{const result=await rpc('music_patch_album',{p_auth_id:auth,p_id:id,p_expected:input.expectedRevision,p_action:input.action,
        p_title:input.action==='update'?input.title:null,p_album_type:input.action==='update'?input.albumType:null,p_description:input.action==='update'?input.description:null,
        p_artwork_asset_id:input.action==='update'?input.artworkAssetId:null,p_publication_ids:input.action==='replace'?input.publicationIds:null,p_key:input.idempotencyKey},cfg);
        if(!result?.ok)return reply({error:publicMusicError(result?.code),revision:result?.revision},musicRpcStatus(result?.code));
        return reply(input.action==='delete'?{deleted:true,idempotent:result.idempotent===true}:{album:result.album,idempotent:result.idempotent===true});
    }catch{return reply({error:'temporarily_unavailable'},502);}
}
