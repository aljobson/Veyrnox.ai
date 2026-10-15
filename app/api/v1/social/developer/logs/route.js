import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../../lib/accountReadLimit.js';
import { socialCustomerApiEnabled } from '../../../../../../lib/social/publishFeature.js';
import { resolveBrand } from '../../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../../packages/db/supabase-client.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES=new Set(['success','error','pending']);
const ROUTES=new Set(['/api/publish/v1/accounts','/api/publish/v1/posts']);
function mapped(result){if(result?.ok)return null;const code=result?.code||'INTERNAL';const status=code==='PLAN_REQUIRED'?402:code==='FORBIDDEN'?403:code==='BRAND_NOT_FOUND'?404:code==='INVALID_INPUT'?400:502;return NextResponse.json({error:status===502?'internal':code.toLowerCase()},{status});}

export async function GET(req){
  const authId=req.headers.get('x-veyrnox-auth-id');
  if(!UUID.test(authId||''))return NextResponse.json({error:'not_authenticated'},{status:401});
  if(!socialCustomerApiEnabled())return NextResponse.json({error:'customer_api_not_open'},{status:404});
  const cfg=envConfig();if(!cfg.supabaseUrl||!cfg.serviceRoleKey)return NextResponse.json({error:'service_unavailable'},{status:503});
  const params=new URL(req.url).searchParams,status=params.get('status'),route=params.get('route'),query=(params.get('q')||'').trim(),limit=params.has('limit')?Number(params.get('limit')):100;
  if((status&&!STATUSES.has(status))||(route&&!ROUTES.has(route))||query.length>80||!Number.isInteger(limit)||limit<1||limit>250)return NextResponse.json({error:'invalid_query'},{status:400});
  const limited=await accountReadLimit(authId,cfg,{logs:[]});if(limited)return limited;
  const brand=await resolveBrand(authId,cfg,'api/v1/social/developer/logs:GET',{request:req,allowedRoles:['owner','manager']});if(brand.error)return brand.error;
  try{const result=await rpc('list_social_api_request_logs',{p_auth_id:authId,p_brand_id:brand.brandId,p_status:status||null,p_route:route||null,p_query:query||null,p_limit:limit},cfg);return mapped(result)||NextResponse.json({logs:result.logs||[]},{headers:{'Cache-Control':'no-store'}});}catch(err){console.error('[social/developer/logs:GET] failed:',err instanceof SupabaseError?err.status:0);return NextResponse.json({error:'internal'},{status:502});}
}
