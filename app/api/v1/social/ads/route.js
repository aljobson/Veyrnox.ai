import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { limitRequestBody } from '../../../../../lib/requestBodyLimit.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { publishPlansEnabled, socialAdsEnabled } from '../../../../../lib/social/publishFeature.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NETWORKS=new Set(['meta','google','tiktok','linkedin','twitter']);
const MODES=new Set(['standalone','boost']);
const OBJECTIVES=new Set(['awareness','traffic','engagement','leads','sales']);
const CURRENCY=/^[A-Z]{3}$/;
const headers={'Cache-Control':'no-store'};

function setup(req){
  const authId=req.headers.get('x-veyrnox-auth-id');
  if(!UUID.test(authId||''))return{error:NextResponse.json({error:'not_authenticated'},{status:401,headers})};
  if(!socialAdsEnabled()||!publishPlansEnabled())return{error:NextResponse.json({error:'ads_not_open'},{status:404,headers})};
  const cfg=envConfig();if(!cfg.supabaseUrl||!cfg.serviceRoleKey)return{error:NextResponse.json({error:'supabase_not_configured'},{status:503,headers})};
  return{authId,cfg};
}
function mapped(result){if(result?.ok)return null;const code=result?.code;const status=code==='PLAN_REQUIRED'?402:code==='FORBIDDEN'?403:['BRAND_NOT_FOUND','POST_NOT_FOUND'].includes(code)?404:['CAMPAIGN_LIMIT','CAMPAIGN_NOT_EDITABLE'].includes(code)?409:code?.startsWith('INVALID_')?400:502;return NextResponse.json({error:status===502?'internal':code.toLowerCase()},{status,headers});}
function https(value){if(value==null||value==='')return null;try{const url=new URL(value);return url.protocol==='https:'&&value.length<=2048?value:null;}catch{return null;}}
function date(value){if(value==null||value==='')return null;const parsed=new Date(value);return Number.isNaN(parsed.valueOf())?undefined:parsed.toISOString();}
function cleanAudience(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const locations=Array.isArray(value.locations)?[...new Set(value.locations.map((item)=>typeof item==='string'?item.trim():'').filter(Boolean))]:[];
  const interests=Array.isArray(value.interests)?[...new Set(value.interests.map((item)=>typeof item==='string'?item.trim():'').filter(Boolean))]:[];
  const ageMin=value.ageMin==null?18:value.ageMin,ageMax=value.ageMax==null?65:value.ageMax;
  if(locations.length>20||interests.length>20||locations.some((v)=>v.length>80)||interests.some((v)=>v.length>80)||!Number.isInteger(ageMin)||!Number.isInteger(ageMax)||ageMin<13||ageMax>100||ageMax<ageMin)return null;
  return{locations,interests,ageMin,ageMax};
}

export async function GET(req){const{authId,cfg,error}=setup(req);if(error)return error;const limited=await accountReadLimit(authId,cfg,{campaigns:[]});if(limited)return limited;const brand=await resolveBrand(authId,cfg,'api/v1/social/ads:GET',{request:req,allowedRoles:['owner','manager','editor','reviewer','analyst','viewer']});if(brand.error)return brand.error;try{const result=await rpc('list_social_ad_campaigns',{p_auth_id:authId,p_brand_id:brand.brandId},cfg);return mapped(result)||NextResponse.json({campaigns:result.campaigns||[],brandRole:brand.role},{headers});}catch(err){console.error('[api/v1/social/ads:GET] failed:',err instanceof SupabaseError?err.status:0);return NextResponse.json({error:'internal'},{status:502,headers});}}

export async function PUT(req){const{authId,cfg,error}=setup(req);if(error)return error;const limitedBody=await limitRequestBody(req);if(limitedBody.response)return limitedBody.response;let body;try{body=await limitedBody.request.json();}catch{return NextResponse.json({error:'invalid_body'},{status:400,headers});}
  const id=body?.id==null?null:body.id,sourcePostId=body?.sourcePostId==null||body.sourcePostId===''?null:body.sourcePostId,name=typeof body?.name==='string'?body.name.trim():'',currency=typeof body?.currency==='string'?body.currency.trim().toUpperCase():'',audience=cleanAudience(body?.audience),destinationUrl=https(body?.destinationUrl),leadFormUrl=https(body?.leadFormUrl),startsAt=date(body?.startsAt),endsAt=date(body?.endsAt);
  if((id&&!UUID.test(id))||(sourcePostId&&!UUID.test(sourcePostId))||!NETWORKS.has(body?.network)||!MODES.has(body?.mode)||!OBJECTIVES.has(body?.objective)||!name||name.length>120||!Number.isInteger(body?.dailyBudgetCents)||body.dailyBudgetCents<100||body.dailyBudgetCents>100000000||!CURRENCY.test(currency)||!audience||(body?.destinationUrl&&destinationUrl===null)||(body?.leadFormUrl&&leadFormUrl===null)||startsAt===undefined||endsAt===undefined||(endsAt&&(!startsAt||endsAt<=startsAt))||(body?.mode==='boost'&&!sourcePostId))return NextResponse.json({error:'invalid_body'},{status:400,headers});
  const limited=await socialPostWriteLimit(authId,cfg);if(limited)return limited;const brand=await resolveBrand(authId,cfg,'api/v1/social/ads:PUT',{request:req,allowedRoles:['owner','manager','editor']});if(brand.error)return brand.error;try{const result=await rpc('save_social_ad_campaign',{p_auth_id:authId,p_brand_id:brand.brandId,p_id:id,p_source_post_id:sourcePostId,p_network:body.network,p_mode:body.mode,p_name:name,p_objective:body.objective,p_daily_budget_cents:body.dailyBudgetCents,p_currency:currency,p_audience:audience,p_destination_url:destinationUrl,p_lead_form_url:leadFormUrl,p_starts_at:startsAt,p_ends_at:endsAt},cfg);return mapped(result)||NextResponse.json({campaign_id:result.campaign_id,created:result.created},{status:result.created?201:200,headers});}catch(err){console.error('[api/v1/social/ads:PUT] failed:',err instanceof SupabaseError?err.status:0);return NextResponse.json({error:'internal'},{status:502,headers});}}

export async function DELETE(req){const{authId,cfg,error}=setup(req);if(error)return error;const id=new URL(req.url).searchParams.get('id');if(!UUID.test(id||''))return NextResponse.json({error:'invalid_id'},{status:400,headers});const limited=await socialPostWriteLimit(authId,cfg);if(limited)return limited;const brand=await resolveBrand(authId,cfg,'api/v1/social/ads:DELETE',{request:req,allowedRoles:['owner','manager','editor']});if(brand.error)return brand.error;try{const result=await rpc('delete_social_ad_campaign',{p_auth_id:authId,p_brand_id:brand.brandId,p_id:id},cfg);return mapped(result)||NextResponse.json({ok:true},{headers});}catch(err){console.error('[api/v1/social/ads:DELETE] failed:',err instanceof SupabaseError?err.status:0);return NextResponse.json({error:'internal'},{status:502,headers});}}
