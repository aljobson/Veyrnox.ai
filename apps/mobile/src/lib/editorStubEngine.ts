import { PROTOCOL } from './editorBridge';
export const STUB_ENGINE_VERSION = 'stub-1';
export function stubEngineHtml(): string {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<style>body{font:16px system-ui;padding:12px}textarea{box-sizing:border-box;width:100%;min-height:180px;font:inherit}</style></head>
<body><h1>Developer stub editor</h1><label for="brief">Project brief</label><textarea id="brief" maxlength="6000" disabled></textarea><p id="counts"></p><div id="assets"></div>
<script>(function(){
var protocol=${PROTOCOL}, doc=null, id=null, timer=null, assets={}, initialized=false;
var brief=document.getElementById('brief');
function send(m){m.v=protocol;window.ReactNativeWebView.postMessage(JSON.stringify(m));}
function current(){return Object.assign({},doc,{brief:brief.value});}
function changed(){timer=null;if(doc){doc=current();send({type:'changed',projectId:id,document:doc});}}
brief.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(changed,500);});
function receive(e){var m;try{m=JSON.parse(e.data);}catch(_){return;}if(m.v!==protocol)return;
if(m.type==='init'){initialized=m.protocol===protocol;return;}
if(!initialized)return;
if(m.type==='load'){
clearTimeout(timer);timer=null;doc=m.document;id=m.projectId;brief.value=doc.brief||'';brief.disabled=false;
var tl=doc.timeline||{};document.getElementById('counts').textContent=['video','audio','text'].map(function(k){return k+': '+(Array.isArray(tl[k])?tl[k].length:0);}).join(' · ');
assets={};document.getElementById('assets').textContent='';
(m.imports||[]).slice(0,10).forEach(function(item,i){var reqId='import-'+i,p=document.createElement('p');assets[reqId]=p;document.getElementById('assets').appendChild(p);send({type:'asset-request',reqId:reqId,mediaId:item.mediaId});});
send({type:'ready',projectId:id});
}else if(m.type==='flush'&&doc){clearTimeout(timer);timer=null;doc=current();send({type:'flushed',nonce:m.nonce,projectId:id,document:doc});
}else if((m.type==='asset'||m.type==='asset-error')&&assets[m.reqId]){assets[m.reqId].textContent=m.type==='asset'?'asset ok':'asset error';}}
window.addEventListener('message',receive);document.addEventListener('message',receive);
send({type:'hello',protocol:protocol,engine:{kind:'stub',version:'${STUB_ENGINE_VERSION}'},caps:{secureContext:!!window.isSecureContext,webcodecs:typeof VideoEncoder!=='undefined',offscreenCanvas:typeof OffscreenCanvas!=='undefined'}});
setInterval(function(){send({type:'beat'});},1000);
})();</script></body></html>`;
}
