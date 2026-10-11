import { checkLocalFile, checkProbe } from './editorMedia.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const DEVICE_LIBRARY_LIMITS = { bytes: 500 * 1024 * 1024, files: 100 };
const scope = actor => { if (actor !== 'guest' && !UUID.test(actor || '')) throw new Error('Choose your current account.'); return actor; };
const digest = async file => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
function open(factory = globalThis.indexedDB) {
    if (!factory) return Promise.reject(new Error('Device Library storage is unavailable in this browser.'));
    return new Promise((resolve,reject)=>{
        const request=factory.open('veyrnox-device-library',1);
        request.onupgradeneeded=()=>{ const db=request.result;db.createObjectStore('media',{keyPath:'key'}).createIndex('actor','actor');db.createObjectStore('files',{keyPath:'key'}); };
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(new Error('Device Library storage could not be opened.'));
        request.onblocked=()=>reject(new Error('Close other Library tabs and retry.'));
    });
}
function transaction(db,stores,mode,run) {
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(stores,mode);let result,problem;
        tx.oncomplete=()=>{db.close();resolve(result);};
        tx.onerror=tx.onabort=()=>{db.close();reject(problem || new Error(tx.error?.name==='QuotaExceededError'?'Device storage is full. Your original file is unchanged.':'Device Library storage failed. Retry without closing the editor.'));};
        run(tx,value=>{result=value;},error=>{problem=error;tx.abort();});
    });
}
export async function listDeviceLibrary(actor, {factory}={}) {
    scope(actor);const db=await open(factory);
    return transaction(db,['media'],'readonly',(tx,done)=>{const request=tx.objectStore('media').index('actor').getAll(actor);request.onsuccess=()=>done(request.result.sort((a,b)=>b.createdAt-a.createdAt).map(({key,actor:owner,...row})=>{void key;void owner;return {...row,source:'device',mediaId:`d-${row.id}`};}));});
}
/** Store original, decoded bytes on this browser only; no upload or signed URL is involved. */
export async function saveDeviceLibrary(actor,file,probe,{factory,isCurrent=()=>true}={}) {
    scope(actor);const bad=checkLocalFile(file).error || checkProbe(probe);if(bad)throw new Error(bad);
    const sha256=await digest(file);if(!isCurrent())throw new Error('The account changed. Retry from the current account.');
    const db=await open(factory);
    return transaction(db,['media','files'],'readwrite',(tx,done,fail)=>{
        const media=tx.objectStore('media'),request=media.index('actor').getAll(actor);
        request.onsuccess=()=>{
            if(!isCurrent())return fail(new Error('The account changed. Retry from the current account.'));
            const rows=request.result,existing=rows.find(row=>row.sha256===sha256 && row.label===file.name.slice(0,180));
            if(existing){done({...existing,source:'device',mediaId:`d-${existing.id}`});return;}
            if(rows.length>=DEVICE_LIBRARY_LIMITS.files || rows.reduce((sum,row)=>sum+row.size,0)+file.size>DEVICE_LIBRARY_LIMITS.bytes)return fail(new Error('Device Library holds up to 100 files and 500 MiB. Download or move your originals before adding more.'));
            const id=crypto.randomUUID(),key=`${actor}/${id}`,row={key,actor,id,label:file.name.slice(0,180),kind:probe.kind,size:file.size,mime:file.type,sha256,createdAt:Date.now()};
            media.put(row);tx.objectStore('files').put({key,file});done({...row,source:'device',mediaId:`d-${id}`});
        };
    });
}
export async function loadDeviceLibrary(actor,id,{factory,isCurrent=()=>true}={}) {
    scope(actor);if(!UUID.test(id || ''))throw new Error('The device file ID is invalid.');const db=await open(factory),key=`${actor}/${id}`;
    const row=await transaction(db,['media','files'],'readonly',(tx,done)=>{const meta=tx.objectStore('media').get(key);meta.onsuccess=()=>{const bytes=tx.objectStore('files').get(key);bytes.onsuccess=()=>done({meta:meta.result,file:bytes.result?.file});};});
    if(!row?.meta || !row.file || !isCurrent())throw new Error('This file is not saved on this device for the current account. Choose the original again.');
    if(row.file.size!==row.meta.size || await digest(row.file)!==row.meta.sha256)throw new Error('The device copy is incomplete. Choose the original again.');
    if(!isCurrent())throw new Error('The account changed. Retry from the current account.');
    return {blob:row.file,kind:row.meta.kind,label:row.meta.label};
}
