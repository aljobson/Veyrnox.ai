import * as React from 'react';
import { fixture } from './publicSiteRender.mjs';
import { emptyFilm, stageIssues } from '../../app/veyrnox/_lib/filmStudio.js';
import { ODDLING_ARCHETYPES } from '../../app/veyrnox/_lib/character.js';
import { CHARACTER_GROUPS } from '../../app/veyrnox/_lib/character.js';
import { SLIDER_SCALES, SWATCHES } from '../../app/veyrnox/_lib/oddlingCatalog.js';
export const files = Object.fromEntries(Object.entries({
 camera:'CameraPanel.js',goal:'CreateGoalPicker.js',download:'DownloadAsset.js',settings:'GenerationSettings.js',catalog:'OddlingCatalogControls.js',explore:'OddlingExplore.js',filters:'OddlingExploreFilters.js',gallery:'OddlingGalleryPreview.js',mannequin:'OddlingMannequin.js',motion:'OddlingMotionPanel.js',portrait:'OddlingPortrait.js',sheet:'OddlingSheet.js',paywall:'PaywallPrompt.js',referral:'ReferralPanel.js',duration:'SourceDurationCard.js',rights:'SourceRightsConfirmation.jsx',topups:'TopUpHistory.js',usage:'UsageMeters.js',voice:'VoiceDescription.js',picker:'chat/ModelPicker.js',skills:'chat/SkillsPanel.js',drafts:'chat/StudioDraftCards.js',stems:'editor/AudioStemResult.js',transition:'editor/TransitionPreview.js',boards:'film/FilmBoards.js',fields:'film/FilmFields.js',save:'film/FilmMasterSave.js',passports:'film/FilmPassports.js',
}).map(([key,file])=>[key,`app/veyrnox/_components/${file}`]));
files.activity='app/veyrnox/app/publish/activity/page.js';
export const metadataFiles=['app/veyrnox/app/editor/layout.js','app/veyrnox/app/editor/review/page.js','app/veyrnox/app/film-studio/page.js'];
const noop=()=>{},nil=()=>null;
const model={id:'model',name:'User model',kind:'image',maker:'test',maker_label:'Provider',credits:1,credits_per_reply:1,media:{image:{required:true},audio:{required:true}},aspects:['16:9']};
const oddling=ODDLING_ARCHETYPES[0];
const film={...emptyFilm(),shots:[{id:'User shot',location:'@room:v1',characters:'@actor:v1',props:'none',seconds:'10'}],boards:[{id:'board',name:'@room:v1',type:'location',decision:'revise',references:[{kind:'anti-reference',source:'User source',caption:'User caption'}]}],assets:[{tag:'@room',version:1,type:'location',descriptor:'User descriptor',references:['User file'],tests:{}}]};
const job={job_id:'job',state:'succeeded',has_asset:true,asset_url:'https://example.test/audio.wav',model_id:'demucs-stems'};
export const scenarios=[
 ...[false,true].map(enabled=>({area:'camera',name:'CameraPanel',props:{enabled,settings:{camera:'ARRI Alexa 35',lens:'Cooke',focal:35,aperture:'f/2.8'},onToggle:noop,onChange:noop}})),
 {area:'goal',name:'CreateGoalPicker',props:{goal:'image',onChange:noop}},
 ...['', '999999999999999999999999'].map(seed=>({area:'settings',name:'GenerationSettings',props:{model:{takesSeed:true,takesNegative:true},seed,negative:'',onSeed:noop,onNegative:noop}})),
 {area:'download',name:'DownloadAsset',props:{row:job}},
 {area:'download',name:'DownloadAsset',props:{row:job},states:['vocals',true,'Provider message']},
 {area:'catalog',name:'SwatchGroup',props:{group:CHARACTER_GROUPS.find(g=>SWATCHES[g.id]),value:'',onChange:noop}},
 {area:'catalog',name:'SliderGroup',props:{group:CHARACTER_GROUPS.find(g=>SLIDER_SCALES[g.id]),picks:{},onChange:noop}},
 {area:'catalog',name:'TileGroup',props:{group:CHARACTER_GROUPS.find(g=>g.id==='hair')||CHARACTER_GROUPS[0],picks:{},value:'',onChange:noop,categoryId:'body'}},
 {area:'explore',name:'OddlingExplore',props:{explore:{source:'all',kind:'human',previewsPlaying:true,selectSource:noop,selectKind:noop,togglePreviews:noop},onSheet:noop,onRecreate:noop,onAnimate:noop}},
 {area:'filters',name:'OddlingExploreFilters',props:{source:'all',kind:'human',onSource:noop,onKind:noop}},
 {area:'gallery',name:'PuppetCanvas',props:{id:oddling.id,playing:false},states:[false,true]},
 {area:'mannequin',name:'OddlingMannequin',props:{picks:{}}},
 {area:'motion',name:'OddlingMotionPanel',props:{portrait:{name:'User character',image:'/portrait.webp'},priceLine:'Provider price',motionId:'',onMotion:noop}},
 {area:'portrait',name:'CharacterPortrait',props:{oddling}},
 {area:'sheet',name:'OddlingSheet',props:{oddling,onClose:noop,onRecreate:noop,onAnimate:noop}},
 ...['first','low','depleted'].map(reason=>({area:'paywall',name:'PaywallOffer',props:{reason,onClose:noop,subscriptionsOpen:reason==='depleted'}})),
 ...[0,1,2,11,21].map(referred=>({area:'referral',name:'ReferralPanel',states:[{code:'user-code',referred}]})),
 {area:'duration',name:'SourceDurationCard',props:{model:{id:'latentsync',media:{video:{maxSeconds:30,required:true}}}}},
 ...[false,true].map(confirmed=>({area:'rights',name:'default',props:{confirmed,onChange:noop}})),
 {area:'topups',name:'TopUpHistory',states:[null,true,null,false]},
 {area:'topups',name:'TopUpHistory',states:[[],false,null,false]},
 {area:'topups',name:'TopUpHistory',states:[[{id:'a',status:'credited',credits:1200,price_usd_cents:999,created_at:'2026-10-18T10:00:00Z'},{id:'b',status:'future_status',credits:50,price_usd_cents:199,created_at:'2026-10-17T10:00:00Z'}],false,{id:'next'},false]},
 {area:'usage',name:'UsageMeters',states:[{spent:{day:1234,week:4567,month:9876},truncated:true},false]},
 {area:'voice',name:'VoiceDescription',props:{value:'',onChange:noop}},
 {area:'picker',name:'CostFilter',props:{tiers:new Set(['low']),onTiers:noop}},
 {area:'picker',name:'ModelPicker',props:{models:[model,{...model,id:'m2',credits_per_reply:2}],model,tiers:new Set(),onSelect:noop}},
 {area:'skills',name:'SkillsPanel',props:{selectedId:'',onPick:noop}},
 {area:'drafts',name:'StudioDraftCards',props:{models:[model],text:'```studio\n{"model":"model","prompt":"User prompt","aspect":"16:9"}\n```\n```studio\n{"model":"model","prompt":"User prompt"}\n```'}},
 {area:'stems',name:'AudioStemResult',props:{job,onIngest:noop,onError:noop}},
 {area:'transition',name:'TransitionPreview',props:{id:'flash'}},
 {area:'boards',name:'FilmBoards',props:{film,update:noop}},
 {area:'fields',name:'FilmIssues',props:{issues:[]}},
 {area:'fields',name:'FilmIssues',props:{issues:stageIssues(film,2)}},
 {area:'fields',name:'FilmIssues',props:{issues:Array(14).fill('Provider diagnostic')}},
 {area:'save',name:'FilmMasterSave',props:{master:{},jobId:'job',label:'User master'}},
 {area:'save',name:'FilmMasterSave',props:{master:{},jobId:'job',label:'User master'},states:[true,'Checking master…','',null]},
 {area:'save',name:'FilmMasterSave',props:{master:{},jobId:'job',label:'User master'},states:[true,'','',{url:'/app/library#master'}]},
 {area:'passports',name:'FilmPassports',props:{film,models:[model],update:noop,live:true}},
 {area:'activity',name:'default'},
 {area:'activity',name:'Activity',states:[null,null,null,false,'']},
 {area:'activity',name:'Activity',states:[[],null,null,false,'']},
 {area:'activity',name:'Activity',states:[[{id:'e',action:'created_post',source:'publish',actor_email:'user@example.test',created_at:'2026-10-18T10:00:00Z'}],null,null,false,'']},
];
export function makeFixture(locale,messages,scenario={},sourceOverrides={}){
 const file=files[scenario.area];
 return fixture(locale,'/app/film-studio',{messages,signedIn:true,sourceOverrides,states:scenario.states?{[file]:scenario.states}:{},expose:{[files.gallery]:['PuppetCanvas'],[files.activity]:['Activity', 'ActivityError', 'activityNotice']},moduleMocks:{
  'react-dom':{createPortal:node=>node},'./Modal':{Modal:({children})=>React.createElement('div',null,children)},'./TopUpPacks':{TopUpPacks:nil},
  './OddlingGalleryPreview.module.css':{__esModule:true,default:{}},'./OddlingGalleryPreview':{OddlingGalleryPreview:({children})=>children,useGalleryMotionAllowed:()=>false},
  '../BrandSwitcher':{__esModule:true,default:nil},'./FilmPromptOutput':{FilmPromptOutput:({title})=>React.createElement('div',null,title)},
 }});
}
export function renderScenario(scenario,locale,messages,sourceOverrides={}){
 const f=makeFixture(locale,messages,scenario,sourceOverrides);
 const previous=globalThis.window;globalThis.window={location:{origin:'https://example.test'}};
 try{return f.render(React.createElement(f.load(files[scenario.area])[scenario.name],scenario.props||{}));}finally{globalThis.window=previous;}
}
import { visibleText } from './visibleText.mjs';
export { visibleText };
export const labels=html=>[...html.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map(m=>m[0]);
