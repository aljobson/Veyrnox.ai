import { emptySequence,addSequenceMedia,addSequenceClip } from './editorSequence.mjs';
export const PROXY_CACHE_BYTES=128*1024*1024;
export function proxyTimeline(media) {
    if(media.kind!=='video')return {error:'Preview proxies are for video sources.'};
    return addSequenceClip(addSequenceMedia({...emptySequence(),aspect:'source'},media),'video',media.id,{volume:0,len:media.frames});
}
export function proxyCacheProblem(proxies,id,blob) {
    const bytes=[...proxies].reduce((n,[key,value])=>n+(key===id?0:value.size),0)+blob.size;
    return bytes>PROXY_CACHE_BYTES?'The preview proxy cache is full. Remove an existing proxy or use a shorter source.':null;
}
export async function createPreviewProxy(media,blobs,options) {
    const tl=proxyTimeline(media);if(tl.error)throw new Error(tl.error);
    const {Input,BlobSource,ALL_FORMATS}=await import('mediabunny');
    const input=new Input({source:new BlobSource(blobs.get(media.id)),formats:ALL_FORMATS});
    try{const track=await input.getPrimaryVideoTrack();if(track&&await track.canBeTransparent())throw new Error('Transparent video uses its original source. An MP4 preview proxy would remove transparency.');}finally{input.dispose();}
    const { exportTimeline }=await import('./editorExport.mjs');
    return exportTimeline(tl,blobs,{...options,height:360,frameRate:30,format:'mp4',quality:'compact',bitrate:750000});
}
