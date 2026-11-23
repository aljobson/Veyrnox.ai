import test from 'node:test';
import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const tsUrl=pathToFileURL(createRequire(import.meta.url).resolve('typescript')).href;
register('data:text/javascript,'+encodeURIComponent(`import ts from '${tsUrl}';
export async function load(url,c,next){
 const r=await next(url,c);
 if(url.startsWith('${pathToFileURL(process.cwd()).href}/app/')&&url.endsWith('.js'))return {...r,source:ts.transpileModule(String(r.source),{fileName:'source.jsx',compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ESNext}}).outputText};
 return r;
}
export async function resolve(s,c,next){
 if(s==='next/server')return next('next/server.js',c);
 try{return await next(s,c)}catch(e){if(s.startsWith('.')&&!/\\.[a-z]+$/.test(s))return next(s+'.js',c);throw e}
}`));
Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',PUBLIC_HOST:'https://veyrnox.test',APP_RUNTIME_FLAGS:'{}'});
const {readPublicCatalog,toPublicModels}=await import('../lib/publicCatalog.js');
const {listModels,listModelsForDetails,fallbackModels,findModel}=await import('../app/veyrnox/_lib/modelList.js');
const rows=['edit','extend'].map(task=>({id:`seedance-2.5-${task}`,name:task,active:true,gated_flag:false,provider:'crun',provider_endpoint:`crun:bytedance/seedance2-5-r2v:${task}`,credits_5s:78,modality:'video-to-video'}));
const control={id:'visible-control',name:'Visible control',active:true,gated_flag:false,provider:'fal',provider_endpoint:'fal-ai/flux-2-pro',credits_5s:4,modality:'text-to-image'};
const absent=value=>assert.doesNotMatch(typeof value==='string'?value:JSON.stringify(value),/seedance-2\.5-(edit|extend)/);
const request=path=>new Request(`https://veyrnox.test${path}`,{headers:{'x-veyrnox-auth-id':'11111111-1111-4111-8111-111111111111','x-veyrnox-auth-client-id':'client'}});
test('runtime-off omits both offers from public, pages, sitemap, MCP, developer listings even if catalog rows are active',async t=>{
 t.mock.method(globalThis,'fetch',async url=>{
  assert.equal(new URL(String(url)).pathname,'/rest/v1/model_catalog');
  return Response.json([...rows,control]);
 });
 const publicRows=await readPublicCatalog(); absent(publicRows);assert.equal(publicRows[0].id,control.id);
 for(const list of [await listModels(),await listModelsForDetails(),fallbackModels()])absent(list);
 for(const row of rows)assert.equal(await findModel(row.id),null);
 const {GET:catalog}=await import('../app/api/catalog/route.js');
 const catalogResponse=await catalog(request('/api/catalog'));assert.equal(catalogResponse.status,200);absent(await catalogResponse.text());
 const {developerApi}=await import('../lib/developerApi.js');
 const developer=await developerApi(request('/api/v1/developer/models'),['models']);assert.equal(developer.status,200);absent(await developer.text());
 const {default:sitemap}=await import('../app/sitemap.js');
 const map=await sitemap();absent(map);assert.ok(map.some(row=>row.url.endsWith('/models/visible-control')));
 const {POST:mcp}=await import('../app/api/v1/mcp/route.js');
 const mcpResponse=await mcp(new Request('https://veyrnox.test/api/v1/mcp',{method:'POST',headers:{...Object.fromEntries(request('/').headers),'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'list_models',arguments:{}}})}));
 assert.equal(mcpResponse.status,200);const mcpText=await mcpResponse.text();absent(mcpText);assert.match(mcpText,/visible-control/);
 const {GET:presets}=await import('../app/api/presets/route.js');const presetResponse=await presets(request('/api/presets'));assert.equal(presetResponse.status,200);absent(await presetResponse.text());
 absent(readFileSync('public/llms.txt','utf8'));
});
test('cached public catalog cannot resurrect offers after the runtime switch turns off',async t=>{
 process.env.APP_RUNTIME_FLAGS='{"seedance25":true}';const cached=toPublicModels([...rows,control]);assert.equal(cached.length,3);process.env.APP_RUNTIME_FLAGS='{}';
 const previous=globalThis.caches;t.after(()=>{if(previous===undefined)delete globalThis.caches;else globalThis.caches=previous;});
 globalThis.caches={default:{match:async()=>new Response(JSON.stringify(cached),{headers:{'X-Fetched-At':String(Date.now())}})}};
 t.mock.method(globalThis,'fetch',()=>assert.fail('fresh cache should not fetch'));
 const result=await readPublicCatalog();absent(result);assert.equal(result[0].id,control.id);
});
test('template availability cannot select either Seedance 2.5 offer',async()=>{
 const {TEMPLATE_CLIPS}=await import('../app/veyrnox/_lib/templateClips.js');
 const {templateClipAvailable}=await import('../lib/templateClipGate.js');
 assert.ok(TEMPLATE_CLIPS.length>0);
 for(const clip of TEMPLATE_CLIPS)assert.equal(templateClipAvailable(clip.id,{env:{TEMPLATE_CLIP_ENABLED:'true',APP_RUNTIME_FLAGS:'{}'},catalog:rows}),false);
 const {templateSwapAvailable}=await import('../lib/templateSwapClipGate.js');
 const {swapSceneAvailable}=await import('../lib/swapSceneGate.js');
 for(const row of rows){
  assert.equal(templateSwapAvailable('test',{env:{MULTI_REFERENCE_ENABLED:'true',APP_RUNTIME_FLAGS:'{"templateSwap":true}'},registry:['test'],manifest:{test:{}},catalog:[row]}),null);
  assert.equal(swapSceneAvailable('test',{env:{APP_ENV:'staging'},scenes:[{id:'test',swapOffer:row.id,people:1}],manifest:{test:{}},catalog:[row]}),false);
 }
});
