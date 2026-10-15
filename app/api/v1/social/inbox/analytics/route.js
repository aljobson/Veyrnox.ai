import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../../lib/accountReadLimit.js';
import { publishPlansEnabled, socialInboxEnabled } from '../../../../../../lib/social/publishFeature.js';
import { resolveBrand } from '../../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../../packages/db/supabase-client.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANGES=new Set([7,30,90]);
const headers={'Cache-Control':'no-store'};

export async function GET(req){
  const authId=req.headers.get('x-veyrnox-auth-id');
  if(!UUID.test(authId||''))return NextResponse.json({error:'not_authenticated'},{status:401,headers});
  if(!socialInboxEnabled()||!publishPlansEnabled())return NextResponse.json({error:'publish_inbox_not_open'},{status:503,headers});
  const cfg=envConfig();if(!cfg.supabaseUrl||!cfg.serviceRoleKey)return NextResponse.json({error:'service_unavailable'},{status:503,headers});
  const params=new URL(req.url).searchParams,accountId=params.get('accountId')||null,days=params.has('days')?Number(params.get('days')):30;
  if((accountId&&!UUID.test(accountId))||!RANGES.has(days))return NextResponse.json({error:'invalid_filter'},{status:400,headers});
  const limited=await accountReadLimit(authId,cfg,{summary:{conversations:0,received:0,sent:0,failed:0,read_actions:0,median_response_seconds:null},trend:[],platforms:[],heatmap:[]});if(limited)return limited;
  const brand=await resolveBrand(authId,cfg,'api/v1/social/inbox/analytics:GET',{request:req,allowedRoles:['owner','manager','editor','reviewer','analyst','viewer']});if(brand.error)return brand.error;
  try{const result=await rpc('get_social_inbox_analytics',{p_auth_id:authId,p_brand_id:brand.brandId,p_account_id:accountId,p_days:days},cfg);if(result?.ok)return NextResponse.json({range_days:result.range_days,since:result.since,summary:result.summary,trend:result.trend||[],platforms:result.platforms||[],heatmap:result.heatmap||[]},{headers});const code=result?.code||'INTERNAL',status=code==='PLAN_REQUIRED'?402:code==='ACCOUNT_NOT_FOUND'?404:code==='INVALID_RANGE'?400:502;return NextResponse.json({error:status===502?'internal':code.toLowerCase()},{status,headers});}catch(err){console.error('[social/inbox/analytics:GET] failed:',err instanceof SupabaseError?err.status:0);return NextResponse.json({error:'internal'},{status:502,headers});}
}
