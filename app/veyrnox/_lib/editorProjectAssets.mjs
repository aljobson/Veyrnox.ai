import { MEDIA_LIMITS } from './editorMedia.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOSTS=new Set(['fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com','fb18d9f7052afbea5a5e0eae69948af2.eu.r2.cloudflarestorage.com']);
export function assetSourceProblem(v){return v===undefined?null:(!v||typeof v!=='object'||Object.keys(v).length!==2||!UUID.test(v.projectId)||!UUID.test(v.assetId))?'Invalid project asset source.':null;}
export async function loadProjectAssetBlob(fetcher,source,fetchBytes=fetch) {
    const problem=assetSourceProblem(source);if(problem || !source)throw new Error(problem || 'Choose a project asset.');
    const asset=await fetcher(`/projects/${source.projectId}/assets/${source.assetId}/download`);
    let url;try{url=new URL(asset.url);}catch{throw new Error('That project asset is unavailable.');}
    if(url.protocol!=='https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password)throw new Error('That project asset URL is invalid.');
    const kind=asset.content_type?.startsWith('video/')?'video':asset.content_type?.startsWith('image/')?'image':asset.content_type?.startsWith('audio/')?'audio':null;
    const cap=kind==='video'?MEDIA_LIMITS.videoBytes:MEDIA_LIMITS.audioBytes;
    if(!kind || !Number.isSafeInteger(asset.byte_size) || asset.byte_size<1 || asset.byte_size>cap)throw new Error('That project asset exceeds the editor file limit.');
    const response=await fetchBytes(url.href,{credentials:'omit',redirect:'error'});if(!response.ok || !response.body)throw new Error('Could not load that project asset.');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>cap || size>asset.byte_size){await reader.cancel();throw new Error('That project asset is larger than its inspected size.');}chunks.push(value);}}finally{reader.releaseLock();}
    if(size!==asset.byte_size)throw new Error('That project asset download was incomplete.');
    return {blob:new Blob(chunks,{type:asset.content_type}),kind};
}
