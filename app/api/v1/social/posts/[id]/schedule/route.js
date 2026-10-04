import { NextResponse } from 'next/server';
import { calendarEnabled } from '../../../../../../../lib/social/publishFeature.js';
import { socialPostWriteLimit } from '../../../../../../../lib/socialPostWriteLimit.js';
import { instant, UUID_RE } from '../../../../../../../lib/social/calendar.js';
import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';

export async function PATCH(req,{params}) {
    const authId=req.headers.get('x-veyrnox-auth-id');
    if(!authId||!UUID_RE.test(authId))return NextResponse.json({error:'not_authenticated'},{status:401});
    if(!calendarEnabled())return NextResponse.json({error:'calendar_not_open'},{status:503});
    const {id}=await params;
    if(!UUID_RE.test(id||''))return NextResponse.json({error:'invalid_post_id'},{status:400});
    let body;try{body=await req.json();}catch{return NextResponse.json({error:'invalid_body'},{status:400});}
    if(!instant(body?.scheduledAt)||!instant(body?.expectedAt))return NextResponse.json({error:'invalid_schedule'},{status:400});
    const cfg=envConfig();
    if(!cfg.supabaseUrl||!cfg.serviceRoleKey)return NextResponse.json({error:'supabase_not_configured'},{status:503});
    const limited=await socialPostWriteLimit(authId,cfg);if(limited)return limited;
    try{
        const result=await rpc('reschedule_social_post',{p_auth_id:authId,p_post_id:id,p_expected_at:body.expectedAt,p_scheduled_at:body.scheduledAt},cfg);
        if(result?.ok!==true){
            const status=result?.code==='USER_NOT_FOUND'?401:result?.code==='POST_NOT_FOUND'?404
                :['POST_STARTED','SCHEDULE_CHANGED','POST_BUSY'].includes(result?.code)?409:result?.code==='INVALID_SCHEDULE'?400:502;
            return NextResponse.json({error:status===502?'internal':result.code},{status});
        }
        return NextResponse.json({scheduled_at:result.scheduled_at,idempotent:result.idempotent},{headers:{'Cache-Control':'no-store'}});
    }catch{return NextResponse.json({error:'internal'},{status:502});}
}
