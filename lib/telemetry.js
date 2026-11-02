import inventory from './adminRouteInventory.json' with { type: 'json' };
import { cachedRuntimeEnabled, refreshRuntimeSwitchesIfDue } from './runtimeSwitchCache.js';
import { rpc } from '../packages/db/supabase-client.js';

export const TELEMETRY_METHODS = ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'];
const patterns = [...new Set(inventory.map(r=>r.path.replace(/:[A-Za-z0-9_]+/g,':id')))];
// The generic v1 catch-all is a 404 responder, so unknown paths remain other.
const routes = patterns.filter(p=>p!=='/api/v1/:id*').sort((a,b)=>Number(/[+*]$/.test(a))-Number(/[+*]$/.test(b))||(a.match(/:id/g)||[]).length-(b.match(/:id/g)||[]).length||b.length-a.length).map(path=>({path, match:new RegExp('^'+path.split('/').map(p=>p===':id'?'[^/]+':p===':id+'?'.+':p===':id*'?'.*':p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')+'/?$')}));
const pages = new Set(inventory.filter(r=>r.gate==='page').map(r=>r.path.replace(/:[A-Za-z0-9_]+/g,':id')));
const REFERRERS = new Set(['google.com','www.google.com','bing.com','www.bing.com','t.co','facebook.com','www.facebook.com','instagram.com','www.instagram.com','youtube.com','www.youtube.com','veyrnox.ai','www.veyrnox.ai']);
export function telemetryPattern(path) { return routes.find(r=>r.match.test(path))?.path || 'other'; }
export function telemetryDimensions(request) {
  const path=telemetryPattern(new URL(request.url).pathname);
  const country=/^[A-Z]{2}$/.test(request.headers.get('cf-ipcountry')||'')?request.headers.get('cf-ipcountry'):'ZZ';
  const ua=request.headers.get('user-agent')||'';
  const device=/bot|crawler|spider/i.test(ua)?'bot':/ipad|tablet/i.test(ua)?'tablet':/mobile|android|iphone/i.test(ua)?'mobile':'desktop';
  let referrer_host='direct';
  const ref=request.headers.get('referer');
  if(ref) {try {const host=new URL(ref).hostname.toLowerCase();referrer_host=REFERRERS.has(host)?host:'other';}catch{referrer_host='other';}}
  return {path,country,device,referrer_host};
}
export function createTelemetry({enabled,send,now=Date.now,log=()=>console.error('[telemetry] batch dropped')}={}) {
  let counters=new Map(),nextFlush=0,flight=false,version=0;
  function add(row,amounts) {
    let key=JSON.stringify(row);
    // Reserve two slots for overflow, one for each aggregate type.
    if(!counters.has(key)&&counters.size>=498) {
      row=row.kind==='traffic'?{kind:'traffic',hour:row.hour,path_pattern:'other',country:'ZZ',device:'other',referrer_host:'other'}:
        {kind:'route',hour:row.hour,route_pattern:'other',method:'OTHER',status_class:'other'};
      // Keep the first overflow hour until flush; reserve exactly one slot per kind.
      key='overflow:'+row.kind;
    }
    const previous=counters.get(key)||row;
    const entry={...previous};
    for(const [name,value]of Object.entries(amounts)) entry[name]=name==='latency_ms_max'?Math.max(previous[name]||0,value):Math.min(1000000000,(previous[name]||0)+value);
    counters.set(key,entry);
  }
  function start() {if(!enabled()){counters.clear();version++;return null;}return now();}
  function finish(request,response,started,ctx,cfg) {
    if(started===null)return;
    if(!enabled()){counters.clear();version++;return;}
    const time=now(),hour=new Date(Math.floor(time/3600000)*3600000).toISOString();
    const d=telemetryDimensions(request),latency=Math.max(0,Math.min(60000,Math.round(time-started)));
    add({kind:'route',hour,route_pattern:d.path,method:TELEMETRY_METHODS.includes(request.method)?request.method:'OTHER',status_class:response.status>=100&&response.status<600?Math.floor(response.status/100)+'xx':'other'},
      {calls:1,latency_ms_sum:latency,latency_ms_max:latency});
    if(request.method==='GET'&&response.status>=200&&response.status<300&&(pages.has(d.path)||d.path==='other')&&response.headers.get('content-type')?.includes('text/html')&&!request.headers.has('rsc')&&!request.headers.has('next-router-prefetch'))
      add({kind:'traffic',hour,path_pattern:d.path,country:d.country,device:d.device,referrer_host:d.referrer_host},{views:1});
    if(flight||time<nextFlush||!ctx?.waitUntil)return;
    const batchVersion=version,batch=[...counters.values()];counters=new Map();nextFlush=time+60000;flight=true;
    const pending=Promise.resolve().then(()=>batchVersion===version&&enabled()?send(batch,cfg):undefined).catch(()=>log()).finally(()=>{flight=false;});
    ctx.waitUntil(pending);
  }
  return {start,finish};
}
const collector=createTelemetry({enabled:()=>cachedRuntimeEnabled('telemetry'),send:(p_batch,cfg)=>rpc('telemetry_ingest',{p_batch},cfg)});
export const beginTelemetry=()=>collector.start();
export function finishTelemetry(request,response,started,ctx,env) {
  if(started===null)return;
  collector.finish(request,response,started,ctx,{supabaseUrl:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY});
}
// Control-plane discovery is separate from the disabled collector. No visitors
// are inspected here. The runtime cache shares one fetch and backs off errors.
export function refreshTelemetryControl(env,ctx,refresh=refreshRuntimeSwitchesIfDue) {
  if(!ctx?.waitUntil||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return;
  const pending=refresh({supabaseUrl:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY});
  if(pending)ctx.waitUntil(pending.catch(()=>{}));
}
