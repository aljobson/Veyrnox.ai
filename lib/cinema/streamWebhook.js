import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { verifyStreamSignature, mediaObservation, streamConfig, readStreamVideo, STREAM_UID } from './stream.js';
export function streamWebhook({rpcCall=rpc,readVideo=readStreamVideo}={}) {
  return async req=>{
    const requestId=crypto.randomUUID();
    const reply=(error,status)=>{ console.info(JSON.stringify({event:'cinema.stream_webhook',request_id:requestId,status,code:error}));return Response.json({...(status===200?{ok:true}:{error}),request_id:requestId},{status,headers:{'Cache-Control':'no-store'}}); };
    // Continue accepting authenticated completion callbacks while UI flags are
    // off, so stopping new uploads cannot strand existing reservations.
    if(!process.env.CINEMA_STREAM_WEBHOOK_SECRET) return reply('unconfigured',503);
    try {
      const limited=await limitRequestBody(req);if(limited.response) return reply('invalid_body',limited.response.status);
      const bytes=new Uint8Array(await limited.request.arrayBuffer());
      if(!await verifyStreamSignature(bytes,req.headers.get('webhook-signature'),process.env.CINEMA_STREAM_WEBHOOK_SECRET)) return reply('invalid_signature',401);
      let observation;
      let event;
      try { event=JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply('invalid_event',400); }
      if(!STREAM_UID.test(event?.uid || '')) return reply('invalid_event',400);
      observation=mediaObservation(await readVideo(event.uid,streamConfig()));
      if(!observation) return reply('ignored',200);
      const time=Number(/^time=(\d+)/.exec(req.headers.get('webhook-signature'))[1]);
      const result=await rpcCall('observe_cinema_upload',{...observation,p_observed_at:new Date(time*1000).toISOString()},envConfig());
      return result?.ok||result?.ignored?reply('ok',200):reply('temporarily_unavailable',503);
    } catch { return reply('temporarily_unavailable',503); }
  };
}
