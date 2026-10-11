import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBrandKit,brandKitProblem,reviewCommentProblem } from '../lib/editorShared.js';
import { TEXT_DEFAULTS } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { GET as getBrand,PUT as putBrand } from '../app/api/v1/workspaces/[id]/brand-kit/route.js';
import { GET as getReview,POST as postReview,PATCH as resolveReview } from '../app/api/v1/projects/[id]/review/route.js';
import { GET as getAssets } from '../app/api/v1/workspaces/[id]/brand-assets/route.js';
import { loadProjectAssetBlob } from '../app/veyrnox/_lib/editorProjectAssets.mjs';
import { emptySequence,addSequenceMedia,addSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';
import { mediaToRelink,documentForTimeline,timelineFromDocument } from '../app/veyrnox/_lib/editorProject.mjs';
import { emptyProjectDocument } from '../lib/projectDocument.js';
const userId=crypto.randomUUID(),workspace=crypto.randomUUID(),project=crypto.randomUUID(),assetId=crypto.randomUUID(),params={params:Promise.resolve({id:workspace})},projectParams={params:Promise.resolve({id:project})};
Object.assign(process.env,{APP_ENV:'development',PUBLIC_HOST:'http://localhost:3000',SUPABASE_URL:'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_local_test',TENANT_PROJECTS_ENABLED:'true',EDITOR_SHARED_TOOLS_ENABLED:'true',SUPABASE_SERVICE_ROLE_KEY:'must-not-leak'});
const fetchOriginal=globalThis.fetch;test.after(()=>{globalThis.fetch=fetchOriginal;});
const req=(path,method='GET',body)=>new Request(`http://localhost:3000/api/v1/${path}`,{method,headers:{authorization:'Bearer actor-token','x-veyrnox-auth-id':userId,'x-request-id':crypto.randomUUID(),'content-type':'application/json','idempotency-key':'editor-shared-request'},...(body===undefined?{}:{body:JSON.stringify(body)})});
test('brand contracts reject unbounded styles, unsafe metadata and ownership injection',()=>{
    const kit={...emptyBrandKit(),textStyles:[{name:'Heading',size:8,style:TEXT_DEFAULTS}]};assert.equal(brandKitProblem(kit),null);
    for(const k of [{...kit,actor_id:userId},{...kit,palette:['red']},{...kit,fonts:['Remote font']},{...kit,textStyles:[{name:'Bad',size:8,style:{...TEXT_DEFAULTS,lineHeight:99}}]},{...kit,assets:[{projectId:project,assetId,name:'Logo',credit:'',usage:'',url:'javascript:alert(1)'}]}])assert.ok(brandKitProblem(k));
    assert.equal(reviewCommentProblem({revision:1,frame:45,body:'Change this shot\nPlease'}),null);assert.ok(reviewCommentProblem({revision:0,frame:0,body:'Hi'}));assert.ok(reviewCommentProblem({revision:1,frame:0,body:'Hi',actor_id:userId}));
});
test('shared routes stay closed when their separate gate is off',async()=>{
    process.env.EDITOR_SHARED_TOOLS_ENABLED='false';globalThis.fetch=async()=>{throw new Error('No upstream request while disabled');};
    try{for(const [call,request,parameters] of [[getBrand,req(`workspaces/${workspace}/brand-kit`),params],[putBrand,req(`workspaces/${workspace}/brand-kit`,'PUT',{}),params],[getReview,req(`projects/${project}/review?revision=1`),projectParams],[postReview,req(`projects/${project}/review`,'POST',{}),projectParams],[getAssets,req(`workspaces/${workspace}/brand-assets`),params]])assert.equal((await call(request,parameters)).status,404);}finally{process.env.EDITOR_SHARED_TOOLS_ENABLED='true';}
});
test('shared RPC routes forward only the caller token and validated payload; conflicts are safe',async()=>{
    let calls=0;globalThis.fetch=async(url,init)=>{calls++;assert.equal(init.headers.authorization,'Bearer actor-token');assert.equal(init.redirect,'manual');assert.ok(!JSON.stringify(init).includes('must-not-leak'));assert.equal(JSON.parse(init.body).p_workspace_id,workspace);return Response.json({message:'private host secret SQL'},{status:409});};
    const saved=await putBrand(req(`workspaces/${workspace}/brand-kit`,'PUT',{expected_version:0,kit:emptyBrandKit()}),params);assert.equal(saved.status,409);assert.ok(!(await saved.text()).includes('private host'));assert.equal(calls,1);
    await putBrand(req(`workspaces/${workspace}/brand-kit`,'PUT',{expected_version:0,kit:{...emptyBrandKit(),actor_id:userId}}),params);assert.equal(calls,1);
    const request=req(`projects/${project}/review`,'PATCH',{comment_id:assetId,expected_version:1,resolved:true,actor_id:userId});assert.equal((await resolveReview(request,projectParams)).status,400);
});
test('review pages request the exact saved revision and cursor',async()=>{
    globalThis.fetch=async(url,init)=>{assert.deepEqual(JSON.parse(init.body),{p_project_id:project,p_revision:5,p_before_id:assetId});return Response.json({comments:[],total:0,nextCursor:null});};
    for(const value of ['', '0', '-1', '1.5', '1e2'])assert.equal((await getReview(req(`projects/${project}/review?revision=${value}`),projectParams)).status,400);
    const response=await getReview(req(`projects/${project}/review?revision=5&before=${assetId}`),projectParams);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('inspected project media is streamed within byte bounds without credentials or redirects',async()=>{
    const signed={url:'https://fb18d9f7052afbea5a5e0eae69948af2.eu.r2.cloudflarestorage.com/asset?signature=test',content_type:'image/png',byte_size:4};
    const source={projectId:project,assetId};const loaded=await loadProjectAssetBlob(async path=>{assert.equal(path,`/projects/${project}/assets/${assetId}/download`);return signed;},source,async(url,init)=>{assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');return new Response(new Uint8Array([1,2,3,4]));});assert.equal(loaded.blob.size,4);
    await assert.rejects(loadProjectAssetBlob(async()=>({...signed,url:'https://untrusted.invalid/asset'}),source,async()=>{throw new Error('Must not fetch');}),/URL/);
    await assert.rejects(loadProjectAssetBlob(async()=>({...signed,url:'https://fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com:444/asset'}),source,async()=>{throw new Error('Must not fetch');}),/URL/);
    await assert.rejects(loadProjectAssetBlob(async()=>signed,source,async()=>new Response(new Uint8Array(5))),/larger/);
    await assert.rejects(loadProjectAssetBlob(async()=>signed,source,async()=>new Response(new Uint8Array(3))),/incomplete/);
});
test('brand asset source identity persists and reopening requests its permission-checked download',()=>{
    let t=addSequenceMedia(emptySequence(),{id:`a-${assetId}`,kind:'image',name:'Logo',frames:18000,width:512,height:512,assetSource:{projectId:project,assetId}});t=addSequenceClip(t,'video',`a-${assetId}`);
    const saved=documentForTimeline(emptyProjectDocument(project),t),opened=timelineFromDocument(JSON.parse(JSON.stringify(saved)));assert.equal(opened.problem,null);const need=mediaToRelink(opened.timeline);assert.deepEqual(need.assets,[{id:`a-${assetId}`,projectId:project,assetId,name:'Logo'}]);assert.equal(need.local.length,0);assert.equal(need.library.length,0);
});
