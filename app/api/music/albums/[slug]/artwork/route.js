import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { musicAlbumsEnabled, musicPublicationEnabled } from '../../../../../../lib/musicBackend.js';
import { validAlbumSlug } from '../../../../../../lib/musicAlbums.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured, presignGetUrl } from '../../../../../../packages/adapters/r2.js';

const missing=()=>Response.json({error:'not_found'},{status:404,headers:{'Cache-Control':'no-store'}});
// Supporting anonymous web boundary: public-readable albums may expose artwork here.
// Authenticated iOS payloads never advertise this URL; their v1 route applies viewer blocks.
export async function GET(_request,{params}){
    if(!musicPublicationEnabled()||!musicAlbumsEnabled())return missing();const{slug}=await params;if(!validAlbumSlug(slug))return missing();
    const cfg=envConfig(),r2cfg=r2EnvConfig();if(!cfg.supabaseUrl||!cfg.serviceRoleKey||!r2IsConfigured(r2cfg))return missing();
    try{const result=await rpc('music_resolve_album_artwork',{p_slug:slug},cfg);if(!result?.ok)return missing();
        const signed=await presignGetUrl(result.r2_key,300,r2cfg);return new Response(null,{status:302,headers:{Location:signed.url,'Cache-Control':'no-store'}});
    }catch{return Response.json({error:'temporarily_unavailable'},{status:502,headers:{'Cache-Control':'no-store'}});}
}
