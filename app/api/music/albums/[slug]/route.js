import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicAlbumsEnabled } from '../../../../../lib/musicBackend.js';
import { publicMusicAlbum, validAlbumSlug } from '../../../../../lib/musicAlbums.js';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(_request,{params}){if(!musicAlbumsEnabled())return reply({error:'not_found'},404);const {slug}=await params;if(!validAlbumSlug(slug))return reply({error:'not_found'},404);
 const cfg=envConfig();if(!cfg.supabaseUrl||!cfg.serviceRoleKey)return reply({error:'not_found'},404);try{const result=await rpc('music_read_public_album',{p_slug:slug},cfg);const album=result?.ok&&publicMusicAlbum(result.album);if(!album)return reply({error:'not_found'},404);return reply({album:{...album,tracks:album.tracks.map(track=>({...track,audio_url:`/api/music/public/${track.slug}/asset`}))}});}catch{return reply({error:'temporarily_unavailable'},502);}}
