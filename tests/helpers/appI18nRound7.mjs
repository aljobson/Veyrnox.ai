import * as React from 'react';
import { fixture } from './publicSiteRender.mjs';
import { emptyFilm, promptContext } from '../../app/veyrnox/_lib/filmStudio.js';
import { emptyBrandKit } from '../../lib/editorShared.js';
export const files=Object.fromEntries(Object.entries({deletion:'DeleteAccountPanel.jsx',sources:'SourcePickers.js',original:'editor/OriginalAudioPanel.js',prompts:'film/FilmPrompts.js',brand:'editor/BrandKitPanel.js',credits:'editor/EditorCreditsDialog.js',scenes:'editor/ScenesPanel.js',finder:'editor/ClipFinderPanel.js',filters:'editor/FilterPanel.js',masters:'film/FilmLibraryMasters.js',composer:'chat/ComposerControls.js',captions:'editor/CaptionPanel.js',translation:'editor/CaptionTranslationControls.js',rail:'editor/EditorToolRail.js',review:'editor/ReviewPanel.js'}).map(([key,file])=>[key,'app/veyrnox/_components/'+file]));
Object.assign(files,Object.fromEntries(Object.entries({oauth:'OAuthGrantsPanel.js',brandAssets:'editor/BrandAssetPicker.js',projectFiles:'editor/ProjectFileControls.js',reviewWorkspace:'editor/ReviewWorkspace.js',voiceover:'editor/VoiceoverRecorder.js',layout:'editor/WorkspaceLayout.js',statement:'CreditStatement.js',passkeys:'PasskeyPanel.js',timeline:'editor/TimelineView.js',typography:'editor/TypographyControls.js',oddling:'OddlingCatalog.js',lyrics:'editor/LyricAlignmentControls.js',picture:'editor/SmartPictureControls.js',attach:'chat/AttachBar.js'}).map(([key,file])=>[key,'app/veyrnox/_components/'+file])));
files.contact='app/veyrnox/app/publish/contacts/ContactProfileEditor.js';
const noop=()=>{}, nil=()=>null;
const clip={id:'clip',mediaId:'media',start:0,in:0,len:300,rate:1};
const tl={fps:30,video:[clip],audio:[],text:[],media:{media:{kind:'video',seconds:10,width:1920,height:1080}},tracks:[],markers:[]};
const blobs={current:new Map()};
const film={...emptyFilm(),shots:[{id:'User shot',seconds:'10'}]};
const currentFilm={...film,prompts:[{shot:'User shot',version:2,content:'User prompt unchanged',context:promptContext(film,film.shots[0])}]};
const master={id:'master',label:'User master unchanged',width:1920,height:1080,seconds:12.3,frame_rate:30,sha256:'a'.repeat(64),source_job_id:'source-id',size_bytes:12345};
const model={id:'model',name:'Model unchanged',credits_per_reply:2};
const project={id:'project',workspaceId:'workspace',revision:2};
const common={tl,blobs,apply:noop,onSelect:noop,onSeek:noop,onError:noop,onBusy:noop};
export const scenarios=[
 {area:'deletion',name:'DeleteAccountPanel'},
 {area:'deletion',name:'DeleteAccountPanel',states:[false,{state:'ready',token:'not-submitted',credits:1234},'','']},
 {area:'deletion',name:'DeleteAccountPanel',states:[false,{state:'blocked',blockers:['active_subscription','projects_present','future_code']},'','']},
 {area:'deletion',name:'DeleteAccountPanel',states:[false,{state:'unavailable'},'','']},
 {area:'sources',name:'SourcePickers',props:{media:{image:{required:true,maxPixels:4000000},endImage:{required:false},video:{maxSeconds:20},audio:{}},sources:{},onPick:noop,onLibrary:noop}},
 {area:'sources',name:'SourcePickers',props:{media:{image:{},endImage:{},video:{},audio:{}},sources:{image:{file:{name:'User file.png'},previewUrl:'blob:one'},endImage:{label:'User image',previewUrl:'blob:two'},video:{label:'User video'},audio:{file:{name:'User audio.wav'}}},onPick:noop,onDraw:noop}},
 {area:'original',name:'OriginalAudioPanel',props:{onIngest:noop}},
 {area:'original',name:'OriginalAudioPanel',props:{onIngest:noop},states:['','Music',{id:'preset',title:'User preview',url:'blob:preview'},true,'Provider error unchanged']},
 {area:'prompts',name:'FilmPrompts',props:{film,update:noop,models:[]}},
 {area:'prompts',name:'FilmPrompts',props:{film:currentFilm,update:noop,models:[]},states:['',{},null,'User result','User change','accepted',[],'']},
 {area:'brand',name:'BrandKitPanel',props:{...common,project}},
 {area:'brand',name:'BrandKitPanel',props:{...common,project:null}},
 {area:'credits',name:'EditorCreditsDialog',props:{open:true,onClose:noop},states:[{packs:[{id:'web-small',credits:1234,price_usd_cents:1000}]},'']},
 {area:'credits',name:'EditorCreditsDialog',props:{open:true,onClose:noop},states:[null,'Could not load']},
 {area:'scenes',name:'ScenesPanel',props:common},
 {area:'scenes',name:'ScenesPanel',props:{...common,selected:{track:'video',id:'clip'}},states:[{status:'done',key:'clip:media:0:0:300',rows:[{frame:30,kind:'cut',ticked:true},{frame:90,kind:'cut',ticked:true}],progress:1}]},
 {area:'finder',name:'ClipFinderPanel',props:common},
 {area:'finder',name:'ClipFinderPanel',props:{...common,selected:{track:'video',id:'clip'}},states:[{status:'done',key:'clip:media:0:0:300:0',hadAudio:false,rows:[{frame:30,start:1,end:6,seconds:5,ticked:true,reasons:['Provider reason unchanged']}],progress:1}]},
 {area:'filters',name:'FilterPanel',props:{...common,selected:{track:'video',id:'clip'},selection:[{track:'video',id:'clip'}]}},
 {area:'masters',name:'FilmLibraryMasters',states:[[], 'Could not load',0]},
 {area:'masters',name:'MasterCard',props:{master,fetcher:noop},states:['https://example.test/video.mp4','',false,0]},
 {area:'composer',name:'ComposerTypeTabs',props:{value:'chat',onChange:noop}},
 {area:'composer',name:'ComposerControls',props:{models:[model],model,offer:{thinking:{extra_credits:2},research:{extra_credits:3},web:{extra_credits:1},images:true},opts:{thinking:true},onSelectModel:noop,onOpts:noop,onLibrary:noop}},
 {area:'captions',name:'CaptionPanel',props:{...common,frame:30,tl:{...tl,text:[{id:'caption',caption:true,text:'User caption unchanged',start:30,len:60}]}}},
 ...['checking','available','unavailable','downloadable'].map(value=>({area:'translation',name:'CaptionTranslationControls',props:common,states:['en','es',{pair:'en:es',value},null]})),
 {area:'translation',name:'CaptionTranslationControls',props:common,states:['en','es',null,{stage:'model',fraction:0.5}]},
 {area:'rail',name:'EditorToolRail',props:{panel:'Media',onPanel:noop,sharedTools:true,scenes:true,clipper:true,agent:true}},
 {area:'review',name:'ReviewPanel',props:{project,frame:30,onSeek:noop}},
 {area:'review',name:'ReviewPanel',props:{project:null,frame:0,onSeek:noop}},

 {area:'oauth',name:'OAuthGrantsPanel',states:[[],'ready','',null]},
 {area:'oauth',name:'OAuthGrantsPanel',states:[[{clientId:'client',name:'User assistant unchanged',scopes:['openid'],uri:'https://example.test',grantedAt:'2026-10-01T12:00:00Z'}],'ready','',{clientId:'client',name:'User assistant unchanged'}]},
 {area:'brandAssets',name:'BrandAssetPicker',props:{workspaceId:'workspace',assets:[{projectId:'project',assetId:'asset',name:'User asset',credit:'User credit',usage:'User licence',url:'https://example.test'}],onChange:noop,onIngest:noop},states:[{assets:[{id:'new-asset',project_id:'project',sniffed_type:'video'}],truncated:true},false,'']},
 {area:'brandAssets',name:'BrandAssetPicker',props:{workspaceId:'workspace',assets:[],onChange:noop,onIngest:noop},states:[{assets:[]},false,'']},
 {area:'projectFiles',name:'ProjectFileControls',props:{tl,onLoadTimeline:noop,compact:true,openDisabled:true}},
 {area:'reviewWorkspace',name:'ReviewWorkspace',props:{projectId:'project',revision:2}},
 {area:'reviewWorkspace',name:'ReviewWorkspace',props:{projectId:'project',revision:2},states:[null,0,false,false,[{id:'source',name:'User source'}],'',0]},
 {area:'voiceover',name:'VoiceoverRecorder',props:{onRecord:noop,onError:noop}},
 {area:'voiceover',name:'VoiceoverRecorder',props:{onRecord:noop,onError:noop},states:['recording',61]},
 {area:'layout',name:'WorkspaceLayout',props:{layout:{mediaDock:'left',inspector:true,inspectorWidth:260,previewHeight:55,timelineHeight:180},onChange:noop,compact:true}},
 {area:'statement',name:'CreditStatement',states:[[] ,null,false,true]},
 {area:'statement',name:'CreditStatement',states:[['signup_grant','generation','generation_refund','future_kind'].map((kind,index)=>({kind,id:String(index),delta:1234,created_at:'2026-10-01T12:00:00Z'})),{cursor:'next'},false,false]},
 {area:'passkeys',name:'PasskeyPanel',states:[true,[],'',false,'','',null]},
 {area:'passkeys',name:'PasskeyPanel',states:[true,[{id:'key',created_at:'2026-10-01T12:00:00Z',last_used_at:'2026-10-02T12:00:00Z'}],'',false,'','',{id:'key',friendly_name:'User passkey'}]},
 {area:'timeline',name:'TimelineView',props:{tl:{...tl,text:[{id:'text',text:'User text',start:60,len:60}]},frame:30,ppf:1,selected:{id:'clip'},onSelect:noop,onSeek:noop,onTrim:noop,onMove:noop}},
 {area:'typography',name:'TypographyControls',props:{style:{},onChange:noop}},
 {area:'contact',name:'default',props:{contact:{tags:['user-tag'],notes:'User note',subscription_status:'subscribed'},editable:true,onSave:noop}},
 {area:'contact',name:'default',props:{contact:{tags:[],notes:'User note',subscription_status:'subscribed'},editable:false,onSave:noop}},
 {area:'oddling',name:'OddlingCatalog',props:{picks:{hair:'user-hair'},onPick:noop,onClear:noop}},
 {area:'lyrics',name:'LyricAlignmentControls',props:common},
 {area:'lyrics',name:'LyricAlignmentControls',props:{...common,tl:{...tl,text:[{id:'caption',text:'User lyric',caption:true,wordsEstimated:false,words:[{text:'User',start:0,end:1}]}]}}},
 {area:'picture',name:'SmartPictureControls',props:{item:{smartPicture:{keyEnabled:true,light:1}},onChange:noop}},
 {area:'attach',name:'AttachButton',props:{onPick:noop,full:false}},
 {area:'attach',name:'AttachChips',props:{items:[{id:'image',preview:'https://example.test/image.png'}],onRemove:noop}},
];
import { visibleText } from './visibleText.mjs';
export { visibleText };
export function renderScenario(scenario,locale,messages,sourceOverrides={}){
 const file=files[scenario.area];
 const resource={data:{kit:emptyBrandKit(),canEdit:true,canComment:true,canResolve:true,comments:[{id:'comment',body:'User comment unchanged',frame:60,resolved:false,created_at:'2026-10-01T12:00:00Z'}],truncated:true,total:12,nextCursor:'cursor'},accountId:'user',reload:noop,loadMore:noop,mutate:noop};
 const f=fixture(locale,'/app/editor',{messages,signedIn:true,sourceOverrides,states:scenario.states?{[file]:scenario.states}:{},expose:{[files.masters]:['MasterCard']},moduleMocks:{
 './ConfirmDialog':{ConfirmDialog:({open,title,body,confirmLabel})=>open!==false?React.createElement('section',null,title,body,confirmLabel):null},
 './useEditorResource':{useEditorResource:()=>resource},
 './BrandAssetPicker':{BrandAssetPicker:nil},'./FilmMaster':{FilmMaster:nil},'./FilmPromptOutput':{FilmPromptOutput:({title,prompt})=>React.createElement('div',null,title,prompt)},
 './CaptionTranslationControls':{CaptionTranslationControls:nil},'./SpeechRecognitionControls':{SpeechRecognitionControls:nil},'./LyricAlignmentControls':{LyricAlignmentControls:nil},
 './CompletionFlags':{useEditorCompletionFlags:()=>({localInference:true})},
 '../Logo':{Logo:nil},
 '../../lib/passkeys.js':{passkeysSupported:()=>true},
 './OddlingMannequin':{OddlingMannequin:({label})=>React.createElement('div',{'aria-label':label})},
 './OddlingCatalogControls':{SliderGroup:nil,SwatchGroup:nil,TileGroup:nil},

 }});
 return f.render(React.createElement(f.load(file)[scenario.name],scenario.props||{}));
}
