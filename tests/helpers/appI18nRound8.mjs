import * as React from 'react';
import { fixture } from './publicSiteRender.mjs';
import { emptyFilm, testMatrix, lockContext } from '../../app/veyrnox/_lib/filmStudio.js';
export const files=Object.fromEntries(Object.entries({
 ask:'AskAboutThis.js',asset:'AssetLoadStatus.js',device:'DeviceLibrary.js',draw:'DrawOnImage.js',preview:'JobAssetPreview.js',report:'ReportAsset.js',schedule:'ScheduleGeneration.js',chatText:'chat/ChatText.js',canvas:'chat/MediaCanvas.js',persona:'chat/PersonaPicker.js',effects:'editor/AudioEffectsControls.js',processing:'editor/AudioProcessingControls.js',background:'editor/BackgroundControls.js',handles:'editor/CanvasHandles.js',fields:'editor/EditorFields.js',helper:'editor/EditorHelperLauncher.js',transport:'editor/EditorTransport.js',folders:'editor/FolderControls.js',sources:'editor/GenerationSourceControls.js',mask:'editor/MaskControls.js',bin:'editor/MediaBin.js',details:'editor/MediaDetails.js',speed:'editor/SpeedControls.js',styles:'editor/TextStyleCatalog.js',words:'editor/WordTimingControls.js',breakdown:'film/FilmBreakdown.js',filmFiles:'film/FilmFiles.js',master:'film/FilmMaster.js',output:'film/FilmPromptOutput.js',filmTests:'film/FilmTests.js',
}).map(([key,file])=>[key,'app/veyrnox/_components/'+file]));
files.explore='app/veyrnox/app/page.js';
const noop=()=>{}, nil=()=>null;
const clip={id:'clip',mediaId:'media',start:0,in:0,len:300,rate:1,mask:'circle',maskKeyframes:[{frame:30,x:.5,y:.5,width:1,height:1,rotation:0,feather:0,easing:'linear'}]};
const media={id:'media',kind:'video',name:'User video unchanged',sourceName:'Original file.mp4',frames:300,hasAudio:true,attribution:{credit:'User attribution',usage:'User licence',url:'https://example.test/licence'}};
const tl={fps:30,video:[clip],audio:[],text:[],media:{media},folders:['User folder'],tracks:[],markers:[]};
const common={item:clip,media,onChange:noop,onAll:noop,frame:30};
const model={id:'model',name:'Model unchanged',kind:'image',takesPrompt:true,promptMax:100,aspects:['16:9']};
const film={...emptyFilm(),name:'User film',shots:[{id:'User shot',location:'@room:v1',characters:'@actor:v1',props:'none',seconds:'10',time:'User time',angle:'User angle',size:'User size',oneAction:true,text:'User title',textPlacement:'User placement',textContext:'User context'}],assets:[{tag:'@actor',version:1,type:'character',descriptor:'User descriptor',references:['User reference'],tests:{}}]};
const lockedFilm=structuredClone(film),asset=lockedFilm.assets[0];
for(const row of testMatrix(lockedFilm,asset))asset.tests[row.id]={verdict:'pass',result:row.id};
asset.lock={context:lockContext(lockedFilm,asset)};
const job={job_id:'job-id',state:'succeeded',asset_url:'https://example.test/image.png',mime_type:'image/png'};
export const scenarios=[
 {area:'processing',name:'AudioProcessingControls',props:common},
 {area:'effects',name:'AudioEffectsControls',props:common},
 {area:'mask',name:'MaskControls',props:common},
 {area:'speed',name:'SpeedControls',props:{...common,onCurve:noop,onReverse:noop,onFreeze:noop,onRate:noop}},
 {area:'speed',name:'SpeedControls',props:{...common,item:{...clip,freezeFrame:20}}},
 {area:'words',name:'WordTimingControls',props:{...common,item:{...clip,caption:true,words:[{text:'User word',start:0,len:30}],wordsEstimated:true}}},
 {area:'words',name:'WordTimingControls',props:{...common,item:{...clip,caption:true,words:[{text:'User word',start:0,len:30}]}}},
 {area:'sources',name:'GenerationSourceControls',props:{model:{media:{image:{required:true,maxSeconds:15},audio:{required:false}}},sources:{image:{label:'User image',previewUrl:'https://example.test/image.png'},audio:{file:{name:'User audio'},label:'User audio'}},onFile:noop,onLibrary:noop,onClear:noop}},
 {area:'sources',name:'GenerationSourceControls',props:{model:{media:{image:{label:'Provider label unchanged'}}},sources:{},onFile:noop,onLibrary:noop,onClear:noop}},
 {area:'transport',name:'EditorTransport',props:{frame:30,total:300,playing:false,onPlay:noop,onPause:noop,onSeek:noop,onFit:noop,onShortcuts:noop}},
 {area:'transport',name:'EditorTransport',props:{frame:30,total:300,playing:true,onPlay:noop,onPause:noop,onSeek:noop,onFit:noop,onShortcuts:noop},states:[null,true]},
 {area:'folders',name:'FolderControls',props:{tl,apply:noop}},
 {area:'folders',name:'FolderControls',props:{tl,apply:noop},states:['User folder','User folder']},
 {area:'filmTests',name:'FilmTests',props:{film,update:noop,models:[model]}},
 {area:'filmTests',name:'FilmTests',props:{film:lockedFilm,update:noop,models:[model]}},
 {area:'breakdown',name:'FilmBreakdown',props:{film,update:noop}},
 {area:'filmFiles',name:'FilmFiles',props:{film,onImport:noop}},
 {area:'filmFiles',name:'FilmFiles',props:{film,onImport:noop},states:['','',{name:'Imported user film'}]},
 {area:'filmFiles',name:'FilmFiles',props:{film,onImport:noop},states:['','',{name:''}]},
 {area:'master',name:'FilmMaster',props:{film,attempt:{verdict:'accepted',result:'12345678-1234-1234-1234-123456789012',shot:'User shot',version:1}}},
 {area:'master',name:'FilmMaster',props:{film,attempt:{verdict:'accepted',result:'User output',shot:'User shot',version:1}},states:[null,true,50,'',null]},
 {area:'master',name:'FilmMaster',props:{film,attempt:{verdict:'accepted',result:'User output',shot:'User shot',version:1}},states:[null,false,100,'',{url:'blob:test',width:1920,height:1080,seconds:10,filename:'User file.mp4',fromLibrary:false}]},
 {area:'output',name:'FilmPromptOutput',props:{title:'User title',prompt:'User prompt',modelId:'model',access:'Studio',models:[model],live:true,aspect:'16:9'}},
 {area:'output',name:'FilmPromptOutput',props:{title:'User title',prompt:'x'.repeat(200),modelId:'model',access:'Studio',models:[model],live:true,aspect:'16:9'}},
 {area:'output',name:'FilmPromptOutput',props:{title:'User title',prompt:'User prompt',modelId:'model',access:'Studio',models:[model],live:true,aspect:'16:9',duration:15}},
 {area:'output',name:'FilmPromptOutput',props:{title:'User title',prompt:'User prompt',modelId:'model',access:'Studio',models:[model],live:false,aspect:'1:1'}},
 {area:'canvas',name:'MediaCanvas',props:{kind:'image',media:{jobs:[],model}}},
 {area:'canvas',name:'MediaCanvas',props:{kind:'video',media:{jobs:[job],model,generating:false,clearJobs:noop}}},
 {area:'canvas',name:'MediaCanvas',props:{kind:'audio',media:{jobs:[{...job,asset_url:null,state:'running'}],generating:true,clearJobs:noop}}},
 {area:'device',name:'DeviceFiles',props:{actor:'test-user',kind:'all'},states:[[], '',false,0]},
 {area:'device',name:'DeviceFiles',props:{actor:'test-user',kind:'all'},states:[[{id:'user-file',label:'User file unchanged',size:12345678,kind:'video'}], '',false,0]},
 {area:'bin',name:'MediaBin',props:{tl,onAdd:noop,onRemove:noop}},
 {area:'details',name:'MediaDetails',props:{media,onChange:noop}},
 {area:'explore',name:'default'},
 {area:'ask',name:'AskAboutThis',props:{row:job}},
 {area:'asset',name:'AssetLoadStatus',props:{asset:{loading:true}}},
 {area:'asset',name:'AssetLoadStatus',props:{asset:{error:'Provider message unchanged',retry:noop}}},
 {area:'draw',name:'DrawOnImage',props:{file:{name:'User file'},onDone:noop,onCancel:noop}},
 {area:'preview',name:'JobAssetPreview',props:{job}},
 {area:'report',name:'ReportAsset',props:{row:job}},
 {area:'schedule',name:'ScheduleGeneration',props:{job}},
 {area:'chatText',name:'ChatText',props:{text:'User prose\n\n```js\nconsole.log("User code");\n```'}},
 {area:'chatText',name:'Code',props:{text:'User code',lang:''},states:[true]},
 {area:'persona',name:'PersonaPicker',props:{personas:[],value:'',onSelect:noop,onManage:noop}},
 {area:'persona',name:'PersonaPicker',props:{personas:[{id:'user',name:'User persona'}],value:'user',onSelect:noop,onManage:noop}},
 ...['none','solid','blur','image'].map(type=>({area:'background',name:'BackgroundControls',props:{...common,item:{...clip,background:{type}},media:{image:{kind:'image',id:'image',name:'User background'}}}})),
 {area:'handles',name:'CanvasHandles',props:{...common,kind:'video'}},
 {area:'fields',name:'SelectControl',props:{label:'User field label',value:'source-over',options:['source-over','none','linear','User option'],onChange:noop}},
 {area:'helper',name:'EditorHelperLauncher',props:{host:{},open:true,onToggle:noop}},
 {area:'helper',name:'EditorHelperLauncher',props:{host:{},open:false,onToggle:noop}},
 {area:'styles',name:'TextStyleCatalog',props:{frame:30,apply:noop,onSelect:noop},states:['No matching user query']},
 {area:'styles',name:'TextStyleCatalog',props:{frame:30,apply:noop,onSelect:noop}},
];
import { visibleText } from './visibleText.mjs';
export { visibleText };
export function renderScenario(scenario,locale,messages,sourceOverrides={}){
 const file=files[scenario.area];
 const f=fixture(locale,'/app/editor',{messages,signedIn:true,sourceOverrides,states:scenario.states?{[file]:scenario.states}:{},expose:{[files.device]:['DeviceFiles'],[files.chatText]:['Code']},moduleMocks:{
  'react-dom':{createPortal:node=>node},'./FilmMasterSave':{FilmMasterSave:({label})=>React.createElement('div',null,label)},
  '../JobAssetPreview':{JobAssetPreview:nil},'../StudioJobGrid':{StudioJobGrid:nil},
  '../_components/PresetGallery':{PresetGallery:nil},'./PublishFlag':{usePublishEnabled:()=>true},
  '../_lib/useAssetUrl':{useAssetUrl:()=>({url:'https://example.test/image.png',loading:false})},
 }});
 return f.render(React.createElement(f.load(file)[scenario.name],scenario.props||{}));
}
