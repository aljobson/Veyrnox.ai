import {emptySequence} from '../../app/veyrnox/_lib/editorSequence.mjs';
export const bytes = doc => new TextEncoder().encode(JSON.stringify(doc));
export function fixture() {
    const tl=emptySequence();tl.seq=3;
    tl.media.source={id:'source',kind:'video',frames:900,name:'camera.mp4',sourceName:'camera.mp4',width:1920,height:1080,hasAudio:true};
    tl.video=[{id:'v1',mediaId:'source',start:0,len:90,in:30,volume:.7,transition:0,trackId:'video-0'}];
    tl.markers=[{id:'m2',frame:45,label:'Beat',color:'#ab1234'}];
    return tl;
}
export const sequence = doc => Object.values(doc.project.items).find(i=>i.kind.Sequence).kind.Sequence;
