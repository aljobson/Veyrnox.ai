import * as React from 'react';
import { fixture } from './publicSiteRender.mjs';
import { emptyFilm } from '../../app/veyrnox/_lib/filmStudio.js';
import { colourDefaults } from '../../app/veyrnox/_lib/editorColour.mjs';
export const files = {
 saved:'app/veyrnox/_components/editor/EditorLibraryRenders.js', tracks:'app/veyrnox/_components/editor/TrackTimeline.js', appeals:'app/veyrnox/app/account/appeals/page.js', contactImport:'app/veyrnox/app/publish/contacts/ContactImportPanel.js', agent:'app/veyrnox/_components/editor/AgentPanel.js', report:'app/veyrnox/app/account/report/page.js', export:'app/veyrnox/_components/editor/ExportPanel.js', colour:'app/veyrnox/_components/editor/ColourControls.js', credits:'app/veyrnox/app/credits/page.js', font:'app/veyrnox/_components/editor/CustomFontPanel.js', setup:'app/veyrnox/_components/film/FilmSetup.js', schedule:'app/veyrnox/app/publish/reports/ReportScheduleFields.js',
};
const noop=()=>{}, nil=()=>null;
const tl={fps:30,aspect:'16:9',width:1920,height:1080,media:{},video:[],audio:[],text:[],tracks:[],markers:[]};
const row={id:'render',label:'User video unchanged',width:1920,height:1080,seconds:12.34,frame_rate:30,expires_at:'2026-11-01T12:00:00Z'};
const sanction={action_id:'action',action:'takedown',created_at:'2026-10-01T12:00:00Z',model_id:'Model unchanged',hold_until:'2099-10-20T12:00:00Z'};
const schedule={deliveryCadence:'weekly',deliveryHourUtc:9,deliveryWeekday:1,deliveryDay:2,deliveryRecipients:[],deliveryFormat:'pdf',deliveryReplyTo:'',deliveryMessage:''};
const font={family:'user-font',name:'User font unchanged',rights:{credit:'User credit unchanged',usage:'User licence unchanged'}};
export const scenarios=[
 {area:'saved',name:'RenderCard',props:{actor:'test-user',row,onRemove:noop},states:['blob:test','','',true]},
 {area:'saved',name:'RenderList',props:{actor:'test-user'},states:[[], 'Provider error unchanged',0,row,false,12]},
 {area:'tracks',name:'TrackTimeline',props:{tl:{...tl,tracks:[{id:'text',kind:'text',name:'User track unchanged',locked:false,hidden:false}],text:[{id:'clip',trackId:'text',start:30,len:90,text:'User caption unchanged',rate:1.5}],markers:[{id:'marker',label:'User marker unchanged',frame:60,color:'#fff'}]},frame:10,ppf:2,selection:[{id:'clip'}],loaded:[],blobs:new Map(),onSelect:noop,onSeek:noop}},
 {area:'appeals',name:'Appeals',states:[{hold_until:'2099-10-20T12:00:00Z',sanctions:[]},'']},
 {area:'appeals',name:'Sanction',props:{sanction,onDone:noop},states:[true,'User statement unchanged',false,'']},
 ...['open','upheld','rejected'].map(appeal_status=>({area:'appeals',name:'Sanction',props:{sanction:{...sanction,appeal_status}}})),
 {area:'contactImport',name:'default',props:{accounts:[{id:'a',label:'User account unchanged'}],onImport:noop}},
 {area:'contactImport',name:'default',props:{accounts:[],onImport:noop},states:['csv']},
 {area:'agent',name:'AgentPanel',props:{tl},states:['',null]},
 {area:'agent',name:'AgentPanel',props:{tl},states:['User command unchanged',{tl,request:{instruction:'User command unchanged'},result:{ok:true,before:{clips:2,end:120},after:{clips:1,end:60},steps:[{index:0,text:'Provider plan unchanged',destructive:true}],skipped:[{},{}],rejected:[]}}]},
 {area:'report',name:'ReportForm'},
 {area:'report',name:'ReportForm',states:['other','User report unchanged',false,'',true]},
 {area:'report',name:'ReportForm',query:'job=10000000-0000-4000-8000-000000000001'},
 {area:'report',name:'ReportForm',query:'title=10000000-0000-4000-8000-000000000001'},
 {area:'export',name:'ExportPanel',props:{tl,name:'User filename',onName:noop,height:1080,onHeight:noop,exporting:true,progress:.5,result:{url:'blob:test',name:'User export.mp4'}}},
 {area:'colour',name:'ColourControls',props:{item:{colourAdjustment:colourDefaults()},onChange:noop}},
 {area:'credits',name:'default',states:[12345,{credits:1234,expiresAt:'2026-11-01T12:00:00Z'},null,[]]},
 {area:'credits',name:'default',states:[null,null,'unavailable',[]]},
 {area:'credits',name:'default',states:[null,null,'sign_in_required',[]]},
 {area:'font',name:'CustomFontPanel',props:{tl:{...tl,fonts:[font]},registry:{current:{has:()=>true}},apply:noop,onError:noop},states:['','','','',true,false]},
 {area:'setup',name:'FilmSetup',props:{film:emptyFilm(),update:noop,models:[]}},
 {area:'setup',name:'FilmInit',props:{film:emptyFilm(),update:noop}},
 {area:'schedule',name:'ReportScheduleFields',props:{enabled:true,deliveryEnabled:true,value:schedule,onChange:noop}},
 {area:'schedule',name:'ReportScheduleFields',props:{enabled:true,deliveryEnabled:false,value:{...schedule,deliveryCadence:'monthly'},onChange:noop}},
];
export const visibleText=html=>html.replace(/<[^>]*>/g,'');
export function renderScenario(scenario,locale,messages,sourceOverrides={}) {
 const file=files[scenario.area];
 const f=fixture(locale,'/app/'+scenario.area,{messages,signedIn:true,sourceOverrides,states:scenario.states?{[file]:scenario.states}:{},expose:{[files.saved]:['RenderList','RenderCard'],[files.appeals]:['Appeals','Sanction'],[files.report]:['ReportForm']},moduleMocks:{
 'next/navigation':{useSearchParams:()=>new URLSearchParams(scenario.query||''),useRouter:()=>({push:noop})},
 '../ConfirmDialog':{ConfirmDialog:({title,body,confirmLabel})=>React.createElement('div',null,title,body,confirmLabel)},
 './EditorDeliveryPanel':{EditorDeliveryPanel:nil},'./AdvancedMediaBin':{MediaArtwork:nil},
 ...Object.fromEntries(['CreditStatement','CreditSubscriptions','UsageMeters','TopUpHistory'].map(name=>['../../_components/'+name,{[name]:nil}])),
 '../../_components/TopUpPacks':{TopUpPacks:nil,TopUpReturn:nil},
 }});
 return f.render(React.createElement(f.load(file)[scenario.name],scenario.props||{}));
}
