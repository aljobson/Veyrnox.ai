import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { calendarEnabled } from '../../../../../lib/social/publishFeature.js';
import { instant, POST_STATUSES, UUID_RE } from '../../../../../lib/social/calendar.js';
const NETWORK_KEYS = new Set(['instagram','facebook','twitter','linkedin','tiktok','youtube','pinterest','threads','bluesky','twitch','gmb']);
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';

export async function GET(req) {
    const authId=req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return NextResponse.json({error:'not_authenticated'},{status:401});
    if (!calendarEnabled()) return NextResponse.json({error:'calendar_not_open'},{status:503});
    const q=new URL(req.url).searchParams;
    const from=q.get('from'),to=q.get('to'),status=q.get('status'),network=q.get('network'),afterAt=q.get('after_at'),afterId=q.get('after_id');
    if (!instant(from) || !instant(to) || Date.parse(to)<=Date.parse(from) || Date.parse(to)-Date.parse(from)>43*86400000
        || (status && !POST_STATUSES.includes(status)) || (network && !NETWORK_KEYS.has(network))
        || (!!afterAt !== !!afterId) || (afterAt && (!instant(afterAt) || !UUID_RE.test(afterId)))) {
        return NextResponse.json({error:'invalid_range'},{status:400});
    }
    const cfg=envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return NextResponse.json({error:'supabase_not_configured'},{status:503});
    const limited=await accountReadLimit(authId,cfg,{posts:[],next:null});if(limited)return limited;
    const {brandId,error}=await resolveBrand(authId,cfg,'social/calendar:GET');if(error)return error;
    try {
        const result=await rpc('list_social_calendar',{p_auth_id:authId,p_brand_id:brandId,p_from:from,p_to:to,
            p_status:status||null,p_network:network||null,p_after_at:afterAt||null,p_after_id:afterId||null},cfg);
        if(result?.ok!==true) return NextResponse.json({error:'internal'},{status:502});
        return NextResponse.json({posts:result.posts||[],next:result.next||null},{headers:{'Cache-Control':'no-store'}});
    } catch { return NextResponse.json({error:'internal'},{status:502}); }
}
