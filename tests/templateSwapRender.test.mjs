import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { translator } from '../lib/i18n/translate.mjs';
import { swapImageCounts, swapFullBody } from '../app/veyrnox/_lib/templateSwapClient.mjs';
const t = translator('en');
let available = false;
const offer = { id:'test',model:'kling-o1-reference',credits:73,durationSeconds:5,images:2,role:'the dancer' };
const model = {id:offer.model,name:'Catalog O1 label'};
const preset = {id:'test',name:'Template',category:'swap',model:'Legacy model',needs:'legacy input',prompt:'Legacy prompt',sourcePromptStatus:'recorded'};
function load(file, mocks) {
  const mod={exports:{}};
  const output=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'), {fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',output)(id=>{
    if(id==='react') return React;if(id==='react/jsx-runtime') return jsx;
    if(Object.hasOwn(mocks,id)) return mocks[id];
    throw Error(`missing mock ${id} in ${file}`);
  },mod,mod.exports);return mod.exports;
}
const shared = {
  '../../../components/I18nProvider.jsx':{useI18n:()=>({t})},
  '../_lib/useTemplateSwapAvailable.js':{useTemplateSwapAvailable:()=>({id:'test',offer:available?offer:null,loading:false})},
  '../_lib/useCatalog.js':{useCatalog:()=>({models:[model],live:true})},
};
const boundary=load('app/veyrnox/_components/TemplateSwapBoundary.js',shared);
const attempts={SwapAttemptStatus:()=>null,swapControl:'min-h-11'};
const composer=load('app/veyrnox/_components/SwapComposer.js',{
  ...shared,'../_lib/useSwapDraft.js':{useSwapDraft:()=>({accountId:'A',attempts:[]})},
  '../_lib/templateSwapRuntime.js':{swapActions:{}},'../_lib/templateSwapClient.mjs':{swapErrorKey:()=>'',unsettled:()=>false,swapImageCounts,swapFullBody},
  '../_lib/useOnlineStatus.js':{useOnlineStatus:()=>true},'./SwapAttemptStatus.js':attempts,
});
const recipe=load('app/veyrnox/_components/TemplateRecipe.js',{
  ...shared,'./TemplateSwapBoundary.js':boundary,'./SwapAttemptStatus.js':attempts,
  '../../../lib/i18n/presetSteps.mjs':{presetStep:()=>''},'next/link':{default:'a',__esModule:true},
  '../_lib/useSwapSceneAvailable':{useSwapSceneAvailable:()=>true},'../_lib/useTemplateClipAvailable':{useTemplateClipAvailable:()=>null},
  '../_lib/templateDraft':{TEMPLATE_PROMPT_MAX:2000},'../_lib/templateSourceBlock':{templateSourceUnsupported:()=>true},
  './UseTemplate':{UseTemplate:({templateSwap})=>templateSwap?React.createElement(composer.SwapComposer,{offer:templateSwap}):React.createElement('span',null,'Legacy composer')},
});
const noop=()=>null;
const page=load('app/veyrnox/presets/[id]/page.js',{
  '../../_components/TemplateSwapBoundary.js':boundary,'../../../../lib/i18n/translate.mjs':{tOr:(t,k,f)=>t.messages[k]?t(k):f},
  '../../../../lib/publicModelIds.js':{publicModelId:x=>x},
  '../../../../lib/templateFraming.js':{templateSourceAspect:()=>null},'../../../../lib/i18n/server':{getT:async()=>({locale:'en',t})},
  '../../../../lib/i18n/metadata.mjs':{},'../../../../lib/i18n/rich':{rich:(text,v)=>React.createElement(React.Fragment,null,text.replace('{model}',''),v.model)},
  '../../../../lib/i18n/locales.mjs':{localizedHref:(_,p)=>p},'next/link':{default:'a',__esModule:true},'next/navigation':{notFound(){throw Error('404');}},'next/server':{},
  '../../_components/NavBar':{MarketingNav:noop},'../../_components/Main':{Main:({children})=>React.createElement('main',null,children)},
  '../../_components/TemplateRecipe':recipe,'../../_components/FilmPlayer':{FilmPlayer:noop},'../../_components/ClipBadge':{ClipBadge:noop},
  '../../_lib/showcase':{SHOWCASE_CLIPS:{}},'../../_lib/tokens':{presetTitle:x=>x,templateModelId:()=> 'legacy',MODELS:[{id:'legacy',name:'Legacy runs-on'}]},
  '../../_lib/templateIds.js':{publicTemplateId:x=>x},'../../_lib/templates':{ALL_TEMPLATES:[preset],templateById:()=>preset},
  '../../_lib/duplicateTemplateIds.js':{duplicateKeeperId:()=>null},'../../_lib/imageTemplates.js':{IMAGE_TEMPLATES:[]},'../../_lib/templateRecipe.js':{templateRecipe:x=>x},
  '../../_components/TemplateImage':{TemplateImage:noop},'../../_lib/templateRecreate.js':{templateRecreateEnabled:()=>false},'../../../seo':{},
});
test('complete public page replaces legacy notice, CTA, model and inputs only on availability 200',async()=>{
  for(const enabled of [false,true]){
    available=enabled;
    const html=renderToStaticMarkup(await page.default({params:Promise.resolve({id:'test'})}));
    for(const marker of ['data-source-unsupported','data-swap-scene-cta','Legacy runs-on','legacy input','Legacy composer']) assert.equal(html.includes(marker),!enabled,marker);
    for(const marker of ['data-swap-composer','Catalog O1 label','73 credits','the dancer']) assert.equal(html.includes(marker),enabled,marker);
    if(enabled) assert.equal((html.match(/type="file"/g)||[]).length,1);
  }
});
test('Create preset and template query use shared availability and catalog-only presentation',()=>{
  for(const query of ['preset=test','template=test','template_id=test']){
    const entry=load('app/veyrnox/_components/SwapCreateEntry.js',{
      'next/navigation':{useSearchParams:()=>new URLSearchParams(query)},'./TemplateSwapBoundary.js':boundary,'./SwapComposer.js':composer,'./SwapAttemptStatus.js':attempts,'./SwapTemplatePreview.js':{SwapTemplatePreview:()=>null},
    });
    for(const enabled of [false,true]){
      available=enabled;
      const html=renderToStaticMarkup(React.createElement(entry.SwapCreateEntry,null,React.createElement('div',null,'Legacy Create')));
      assert.equal(html.includes('data-swap-composer'),enabled);assert.equal(html.includes('Legacy Create'),!enabled);
    }
  }
});
test('rendered reconciliation survives a gate 404 and is invisible to another account', async () => {
  const {createSwapStore}=await import('../app/veyrnox/_lib/templateSwapStore.mjs');
  const store=createSwapStore();store.session('A');
  const record={accountId:'A',templateId:'test',key:'original',state:'unknown',body:{max_charge_credits:47},references:[{key:'front'},{key:'crop'}]};
  store.put(record);
  const realStatus=load('app/veyrnox/_components/SwapAttemptStatus.js',{
    ...shared,'../_lib/useSwapDraft.js':{useSwapDraft:id=>({attempts:store.get(id)})},
    '../_lib/templateSwapRuntime.js':{swapActions:{}},
    '../_lib/templateSwapClient.mjs':await import('../app/veyrnox/_lib/templateSwapClient.mjs'),
    '../app/create/GeneratingProgress.js':{GeneratingProgress:()=>null},
  });
  const saved=attempts.SwapAttemptStatus;attempts.SwapAttemptStatus=realStatus.SwapAttemptStatus;
  try{
    for(const [gate,state,text] of [[true,'unknown','We could not confirm this run; checking.'],[false,'unknown','We could not confirm this run; checking.'],[false,'refund_pending','Refund in progress.'],[false,'refunded','Credits returned.']]){
      available=gate;store.update(store.ticket(record.key),{state});
      const html=renderToStaticMarkup(await page.default({params:Promise.resolve({id:'test'})}));
      assert.ok(html.includes(text));assert.equal(html.includes('Credits returned.'),state==='refunded');assert.ok(!html.includes('Nothing was charged'));
      assert.deepEqual(store.get('test')[0].references,record.references);
    }
    store.session('B');const html=renderToStaticMarkup(await page.default({params:Promise.resolve({id:'test'})}));
    assert.ok(!html.includes('data-swap-attempt'));assert.ok(!html.includes('Credits returned.'));
  }finally{attempts.SwapAttemptStatus=saved;}
});
