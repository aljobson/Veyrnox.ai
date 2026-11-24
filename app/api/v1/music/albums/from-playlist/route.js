import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { musicAlbumsEnabled, musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../../lib/musicBackend.js';
import { parseAlbumConversion } from '../../../../../../lib/musicAlbums.js';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request){
    const auth=request.headers.get('x-veyrnox-auth-id'); if(!validMusicAuthId(auth))return reply({error:'not_authenticated'},401);
    if(!musicAlbumsEnabled())return reply({error:'albums_unavailable'},404); const cfg=envConfig();
    if(!cfg.supabaseUrl||!cfg.serviceRoleKey)return reply({error:'gateway_not_configured'},503);
    const body=await readMusicJson(request);if(!body.ok)return reply({error:body.error},400);const input=parseAlbumConversion(body.value);if(!input.ok)return reply({error:input.error},400);
    try{const result=await rpc('music_convert_playlist_to_album',{p_auth_id:auth,p_id:crypto.randomUUID(),p_playlist_id:input.playlistId,
        p_title:input.title,p_album_type:input.albumType,p_description:input.description,p_artwork_asset_id:input.artworkAssetId,p_key:input.idempotencyKey},cfg);
        if(!result?.ok)return reply({error:publicMusicError(result?.code)},musicRpcStatus(result?.code));
        return reply({album:result.album,included_count:result.included_count||0,excluded_count:result.excluded_count||0,idempotent:result.idempotent===true},result.idempotent?200:201);
    }catch{return reply({error:'temporarily_unavailable'},502);}
}
