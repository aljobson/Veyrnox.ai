import { rpc } from '../../packages/db/supabase-client.js';
import { streamConfig, deleteStreamVideo, STREAM_UID } from './stream.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function removeCinemaUploads(env,{rpcCall=rpc,removeVideo=deleteStreamVideo}={}) {
  if(env.CINEMA_UPLOAD_REMOVAL_ENABLED!=='true') return {ok:true,skipped:'disabled'};
  const result={ok:true,checked:0,removed:0,failed:0};
  const db={supabaseUrl:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY};
  const key=crypto.randomUUID();
  try {
    const cfg=streamConfig(env);
    if(!db.supabaseUrl||!db.serviceRoleKey) throw Error('unconfigured');
    const {items}=await rpcCall('claim_cinema_upload_removals',{p_key:key},db);
    if(!Array.isArray(items)||items.length>10||items.some(item=>!UUID.test(item?.id||'')||typeof item.stream_uid!=='string'||!STREAM_UID.test(item.stream_uid))||new Set(items.map(item=>item.id)).size!==items.length) throw Error('invalid_claim');
    for(let offset=0;offset<items.length;offset+=2) {
      await Promise.all(items.slice(offset,offset+2).map(async item=>{
        result.checked++;
        try {
          if((await removeVideo(item.stream_uid,cfg))?.ok!==true) throw Error('unconfirmed');
          const saved=await rpcCall('finish_cinema_upload_removal',{p_id:item.id,p_key:key},db);
          if(saved?.ok!==true) throw Error('unconfirmed');
          result.removed++;
        } catch {result.failed++;result.ok=false;}
      }));
    }
  } catch {result.failed++;result.ok=false;}
  if(result.checked||!result.ok) console.info(JSON.stringify({event:'cinema.upload_removal',...result}));
  return result;
}
