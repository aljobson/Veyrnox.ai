import * as React from 'react';
import { fixture } from './publicSiteRender.mjs';
import { emptyFilm } from '../../app/veyrnox/_lib/filmStudio.js';
export const files = {
 threads:'app/veyrnox/_components/chat/ThreadList.js', delivery:'app/veyrnox/_components/editor/EditorDeliveryPanel.js', workflows:'app/veyrnox/app/publish/workflows/page.js', insights:'app/veyrnox/app/publish/analytics/PostingInsights.js', queues:'app/veyrnox/app/publish/queues/page.js', film:'app/veyrnox/_components/film/FilmWorkspace.js', animationCatalog:'app/veyrnox/_components/editor/AnimationCatalogPanel.js', catalog:'app/veyrnox/_components/editor/CatalogPanel.js', team:'app/veyrnox/app/publish/team/page.js', packs:'app/veyrnox/_components/TopUpPacks.js', contacts:'app/veyrnox/app/publish/contacts/page.js', mfa:'app/veyrnox/_components/MfaPanel.js', shortcuts:'app/veyrnox/_components/editor/ShortcutGuide.js', inbox:'app/veyrnox/app/publish/inbox/InboxAnalytics.js', animation:'app/veyrnox/_components/editor/AnimationControls.js', speech:'app/veyrnox/_components/editor/SpeechRecognitionControls.js', personas:'app/veyrnox/_components/chat/PersonaManager.js',
};
const noop=()=>{};
const tl={media:{},video:[],audio:[],text:[],tracks:[]};
const thread={id:'chat',title:'User chat unchanged',pinned:true,folder_id:'folder'};
const folders=[{id:'folder',name:'User folder unchanged',count:1234}];
const insight={period_start:'2026-10-01',period_end:'2026-10-18',computed_at:'2026-10-18T12:34:56Z',timezone:'Europe/London',measured_posts:20,recorded_posts:25,history_days:18,heatmap:[{day:1,hour:9,posts:10,score:1234.5}],frequency:[{posts:2,measured_posts:1,avg_interactions:1234.5}]};
const persona={id:'persona',name:'User persona unchanged',instructions:'User instructions unchanged',model_id:'model',thinking:true,web:true};
const clip={id:'clip',start:0,len:120,keyframes:[{frame:30,x:.5,y:.5,scale:1,rotation:0,opacity:1,easing:'linear'}],parameterKeyframes:[{frame:30,easing:'linear'}]};
export const scenarios=[
 {area:'threads',name:'ThreadList',props:{threads:[thread],folders,folder:'folder'}},
 {area:'threads',name:'ThreadList',props:{threads:[thread],folders,folder:'folder'},states:['',null,'',null,null,'delete']},
 {area:'delivery',name:'DeliverySession',props:{actor:'test-user',result:{url:'blob:fixture'}},states:[true,false,'','',true,{uploadsEnabled:false,accounts:[]}]},
 {area:'workflows',name:'WorkflowManager',states:[[],[{id:'workflow',name:'User workflow unchanged',kind:'message',keyword:'User keyword unchanged',match_mode:'exact',suggestion_count:1234,enabled:true}], 'owner',true]},
 {area:'insights',name:'PostingInsights',states:[{insights:insight},false,0]},
 {area:'insights',name:'PostingInsights',states:[{insights:{...insight,measured_posts:0,heatmap:[]}},false,0]},
 {area:'queues',name:'Queues',states:[[],[{id:'queue',name:'User queue unchanged',slots:[{weekday:1,minute:540}],timezone:'UTC',enabled:true}],{id:null,name:'',timezone:'UTC',accountIds:[],enabled:true,slots:[{weekday:1,time:'09:00'}]},false,'','owner']},
 {area:'film',name:'FilmWorkspace',states:[{film:emptyFilm(),stage:0,ready:true,userId:'test-user',saved:true},null]},
 {area:'animationCatalog',name:'AnimationCatalogPanel',props:{tl,selected:null}},
 {area:'animationCatalog',name:'AnimationCatalogPanel',props:{tl,selected:null},states:['loop','']},
 ...['Elements','Templates','Effects','Transitions'].map(panel=>({area:'catalog',name:'CatalogPanel',props:{panel,tl,selected:null,frame:0}})),
 {area:'catalog',name:'CatalogPanel',props:{panel:'Effects',tl,selected:null,frame:0},states:['unlikely user query']},
 {area:'catalog',name:'CatalogPanel',props:{panel:'Effects',tl,selected:null,frame:0},states:['',[],'Your story','#32d6c5',.5,'body']},
 {area:'team',name:'TeamDashboard',states:[{brand_name:'User brand unchanged',actor_role:'owner',members:[{user_id:'test-user',email:'owner@example.test',role:'owner',joined_at:'2026-10-01T12:34:56Z'},{user_id:'member',email:'member@example.test',role:'editor',joined_at:'2026-10-01T12:34:56Z'}],invitations:[{id:'invite',email:'invite@example.test',role:'editor',expires_at:'2026-10-25T12:34:56Z'}]}]},
 {area:'packs',name:'TopUpPacks',props:{signedIn:true},states:[[{id:'pack',credits:100,price_usd_cents:1000}],'pack','id',true,false,null]},
 {area:'packs',name:'TopUpReturn',states:['purchase','credited',1234]},
 {area:'contacts',name:'ContactsDashboard',states:[[],'owner',true,true,{accountId:'',network:'',subscriptionStatus:'',search:'',tag:''},'',[{account_id:'account',external_id:'contact',name:'User contact unchanged',network:'instagram',account_name:'User account unchanged',last_active_at:'2026-10-18T12:34:56Z',thread_count:1,message_count:1234,unread_count:2}],'']},
 {area:'mfa',name:'MfaPanel',props:{requireFresh:true},states:[[{id:'factor',status:'verified'}],false,null,'',false,null,'aal2','2026-10-18T12:34:56Z',true]},
 {area:'mfa',name:'MfaPanel',states:[[],false,{factorId:'factor',uri:'otpauth://fixture',secret:'USER_SECRET_FIXTURE'},'',false,null,'aal1',null,false]},
 {area:'shortcuts',name:'ShortcutGuide',props:{onClose:noop}},
 {area:'inbox',name:'default',states:[30,{summary:{conversations:1234,received:12,sent:10,failed:2,read_actions:9,median_response_seconds:90},trend:[{date:'2026-10-18',received:12,sent:10}],platforms:[{network:'instagram',received:12,sent:10,failed:2}],heatmap:[{weekday:1,hour:9,received:12}]}]},
 {area:'animation',name:'AnimationControls',props:{item:{...clip,animation:{in:'fade',out:'fade',combo:'sway',duration:15,period:60,amount:.5}},onChange:noop}},
 {area:'animation',name:'MotionControls',props:{item:clip,frame:30,onChange:noop}},
 {area:'animation',name:'ParameterControls',props:{item:clip,frame:30,onChange:noop}},
 {area:'speech',name:'SpeechRecognitionControls',props:{tl,blobs:new Map(),apply:noop,onError:noop}},
 {area:'personas',name:'PersonaManager',props:{personas:[persona],models:[],onClose:noop},states:[null,persona,false,null,persona]},
 {area:'personas',name:'PersonaManager',props:{personas:[persona],models:[{id:'model',name:'Model name unchanged'}],onClose:noop},states:['persona',persona,true]},
];
export const visibleText=html=>html.replace(/<[^>]*>/g,'');
const nil=()=>null;
export function renderScenario(scenario,locale,messages,sourceOverrides={}){
 const file=files[scenario.area];
 const f=fixture(locale,'/app/'+scenario.area,{messages,signedIn:true,sourceOverrides,states:scenario.states?{[file]:scenario.states}:{},expose:{[files.delivery]:['DeliverySession'],[files.workflows]:['WorkflowManager'],[files.queues]:['Queues'],[files.team]:['TeamDashboard'],[files.contacts]:['ContactsDashboard']},moduleMocks:{
 '../Modal':{Modal:({children})=>React.createElement('div',null,children)},'../ConfirmDialog':{ConfirmDialog:({title,body,confirmLabel})=>React.createElement('div',null,title,body,confirmLabel)},
 '../BrandSwitcher':{__esModule:true,default:nil},'./ContactProfileEditor':{__esModule:true,default:nil},'./ContactImportPanel':{__esModule:true,default:nil},
 './PersonProcessingControls':{PersonProcessingControls:nil},'./GuidanceCard':{GuidanceCard:nil},
 './FilmFields':{FilmIssues:nil},'./FilmSetup':{FilmSetup:nil,FilmInit:nil},...Object.fromEntries(['FilmFiles','FilmBreakdown','FilmBoards','FilmPassports','FilmTests','FilmPrompts'].map(name=>['./'+name,{[name]:nil}])),
 '../../_lib/useCatalog':{useCatalog:()=>({models:[],live:true})},'../_lib/useCatalog':{useCatalog:()=>({models:[{kind:'video',credits:5},{kind:'image',credits:4}],live:true})},
 }});
 return f.render(React.createElement(f.load(file)[scenario.name],scenario.props||{}));
}
