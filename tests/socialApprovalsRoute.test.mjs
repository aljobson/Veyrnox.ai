import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));

const ownerRoute = await import('../app/api/v1/social/approvals/route.js');
const publicRoute = await import('../app/api/social/approvals/[token]/route.js');
const { createApprovalToken } = await import('../lib/social/approvalToken.js');

const auth='11111111-1111-4111-8111-111111111111',brand='22222222-2222-4222-8222-222222222222';
const account='33333333-3333-4333-8333-333333333333',job='44444444-4444-4444-8444-444444444444';
const requestId='55555555-5555-4555-8555-555555555555',postId='66666666-6666-4666-8666-666666666666';
const reviewerId='77777777-7777-4777-8777-777777777777';
Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',PUBLISH_APPROVALS_ENABLED:'true',
  PUBLISH_TEAMS_ENABLED:'true',SOCIAL_APPROVAL_LINK_SECRET:'approval-route-secret-with-more-than-thirty-two-characters',SOCIAL_MEDIA_PROXY_SECRET:'media-route-secret-with-more-than-thirty-two-characters',ACCOUNT_READ_RATE_LIMIT_ENABLED:'true'});
const request=(url,method='GET',body,extraHeaders={})=>new Request(url,{method,headers:{'x-veyrnox-auth-id':auth,...(body?{'content-type':'application/json'}:{}),...extraHeaders},...(body?{body:JSON.stringify(body)}:{})});
let calls=[];
function stub(overrides={}){calls=[];globalThis.fetch=async(url,init)=>{const name=new URL(url).pathname.split('/').pop(),args=JSON.parse(init.body);calls.push({name,args});return Response.json(overrides[name]??({
  consume_account_read_request:{ok:true},consume_social_post_write_request:{ok:true},get_or_create_default_social_brand:{ok:true,brand_id:brand},
  list_social_accounts:{ok:true,accounts:[{id:account,status:'active',network:'instagram'}]},
  create_social_post_approval:{ok:true,request_id:requestId,post_id:postId,idempotent:false,reviewers:[{id:reviewerId,email:'reviewer@example.com'}]},
  list_social_approvals:{ok:true,requests:[]},get_social_approval_review:{ok:true,reviewer_id:reviewerId,email:'reviewer@example.com',decision:'pending',request_status:'pending',policy:'all',scheduled_at:'2026-11-01T10:00:00Z',global_text:'Review me',brand_name:'Veyrnox',networks:['instagram'],media:null},
  decide_social_approval:{ok:true,idempotent:false,decision:'approved',request_status:'approved'},
})[name]);};}

test('owner creates a validated approval request and receives signed links',async()=>{stub();const res=await ownerRoute.POST(request('https://veyrnox.ai/api/v1/social/approvals','POST',{
  scheduledAt:'2026-11-01T10:00:00Z',globalText:'Review me',idempotencyKey:'approval_12345678',accountIds:[account],media:[{mediaType:'image',jobId:job}],policy:'all',reviewers:['Reviewer@Example.com']
}));assert.equal(res.status,201);const body=await res.json();assert.equal(body.review_links[0].email,'reviewer@example.com');assert.match(body.review_links[0].url,/^https:\/\/veyrnox\.ai\/social\/review\//);assert.equal(calls.at(-1).name,'create_social_post_approval');assert.deepEqual(calls.at(-1).args.p_reviewer_emails,['reviewer@example.com']);});

test('owner route rejects invalid reviewers before database access',async()=>{stub();const res=await ownerRoute.POST(request('https://veyrnox.ai/api/v1/social/approvals','POST',{
  scheduledAt:'2026-11-01T10:00:00Z',globalText:'Review me',idempotencyKey:'approval_12345678',accountIds:[account],media:[{mediaType:'image',jobId:job}],policy:'all',reviewers:['bad']
}));assert.equal(res.status,400);assert.equal(calls.length,0);});

test('read-only brand members cannot receive signed external-review links',async()=>{stub({get_social_brand_access:{ok:true,brand_id:brand,label:'Shared',role:'viewer',owner_auth_id:auth,paid:true}});const res=await ownerRoute.GET(request('https://veyrnox.ai/api/v1/social/approvals','GET',undefined,{'x-publish-brand-id':brand}));assert.equal(res.status,403);assert.deepEqual(await res.json(),{error:'brand_role_forbidden',role:'viewer'});assert.equal(calls.some((call)=>call.name==='list_social_approvals'),false);});

test('signed public link reads the safe projection and records one decision',async()=>{stub();const token=await createApprovalToken({reviewerId},process.env.SOCIAL_APPROVAL_LINK_SECRET);const params=Promise.resolve({token});
  const read=await publicRoute.GET(request(`https://veyrnox.ai/api/social/approvals/${token}`),{params});assert.equal(read.status,200);assert.equal((await read.json()).global_text,'Review me');
  const decided=await publicRoute.POST(request(`https://veyrnox.ai/api/social/approvals/${token}`,'POST',{decision:'approved',comment:'Ready'}),{params});assert.equal(decided.status,200);assert.equal((await decided.json()).request_status,'approved');assert.equal(calls.at(-1).name,'decide_social_approval');});

test('forged public links are rejected without a database call',async()=>{stub();const res=await publicRoute.GET(request('https://veyrnox.ai/api/social/approvals/forged'),{params:Promise.resolve({token:'forged'})});assert.equal(res.status,404);assert.equal(calls.length,0);});
