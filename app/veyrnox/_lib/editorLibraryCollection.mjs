import { listLibraryMedia, loadLibraryBlob } from './editorLibrary.mjs';
import { loadSavedRender } from './editorSavedRender.mjs';
import { listDeviceLibrary, loadDeviceLibrary } from './deviceLibrary.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function librarySourceFromId(id) {
    if(typeof id!=='string')return null;
    const type={d:'device',e:'editor',f:'master'}[id[0]];
    return type && id[1]==='-' && UUID.test(id.slice(2)) ? {source:type,id:id.slice(2),mediaId:id} : null;
}
/** A page of generations plus the account's saved exports and this device's originals. */
export async function listEditorLibrary(call,{actor='guest',cursor=null,deviceList=listDeviceLibrary}={}) {
    const warnings=[];let next=null;
    async function optional(path,key,source,prefix){try{const page=await call(path);return (page[key] || []).filter(row=>UUID.test(row.id || '') && (!row.state || row.state==='stored')).map(row=>({id:row.id,mediaId:`${prefix}-${row.id}`,source,label:row.label || 'Saved video',kind:'video'}));}catch(e){if(e.status===401)throw e;if(e.status!==404)warnings.push(`Could not load ${source==='editor'?'saved edits':'Film Studio masters'}. Retry the Library.`);return [];}}
    let generated=[];
    if(actor!=='guest') {
        const suffix=cursor?`&before=${encodeURIComponent(cursor.before)}&before_id=${encodeURIComponent(cursor.before_id)}`:'';
        const page=await call(`/jobs?limit=24${suffix}`);next=page.next || null;
        if(next && (!UUID.test(next.before_id || '') || !Number.isFinite(Date.parse(next.before))))throw new Error('The Library page could not be read. Retry.');
        generated=await listLibraryMedia(async path=>path.startsWith('/jobs?')?page:call(path),{includeImages:true,concurrency:3,onUnavailable:e=>{if(e.status!==404)warnings.push('Some generated media could not be loaded. Retry the Library.');}});
        generated=generated.map(row=>({...row,source:'generation',mediaId:`j-${row.jobId}${row.stem?'--'+row.stem:''}`}));
    }
    let extras=[];
    if(!cursor){const groups=await Promise.all([deviceList(actor).catch(()=>{warnings.push('Device Library storage is unavailable. Original device files can still be imported.');return [];}),...(actor==='guest'?[]:[optional('/library/editor-renders','renders','editor','e'),optional('/library/masters','masters','master','f')])]);extras=groups.flat();}
    return {items:[...extras,...generated],next,warnings:[...new Set(warnings)]};
}
export async function loadEditorLibraryItem(call,item,{actor='guest',isCurrent=()=>true,fetchBytes=fetch,deviceLoad=loadDeviceLibrary}={}) {
    const source=librarySourceFromId(item.mediaId || item.id);
    if(source?.source==='device')return deviceLoad(actor,source.id,{isCurrent});
    if(actor==='guest')throw new Error('Sign in to open your cloud Library.');
    if(source){const blob=await loadSavedRender(call,{id:source.id,label:item.label || item.name},{fetchBytes,source:source.source});if(!isCurrent())throw new Error('The account changed. Retry from the current account.');return {blob,kind:'video'};}
    if(item.jobId)return loadLibraryBlob(call,item.jobId,fetchBytes,{stem:item.stem});
    throw new Error('That Library source is invalid.');
}
