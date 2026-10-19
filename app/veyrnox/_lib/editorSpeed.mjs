import { helperEnglish } from '../../../lib/helperMessages.mjs';
import { audioProcessingActive } from './editorAudioSettings.mjs';
const finite=(v,min,max)=>typeof v==='number' && Number.isFinite(v) && v>=min && v<=max;
const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).length===keys.length && Object.keys(v).every(k=>keys.includes(k));
export function speedProblem(c) {
    if(c.reverse!==undefined && typeof c.reverse!=='boolean')return helperEnglish('invalid_reverse_setting');
    if(c.freezeFrame!==undefined && !finite(c.freezeFrame,0,1e7))return helperEnglish('invalid_freeze_frame');
    if(c.speedCurve!==undefined && (!Array.isArray(c.speedCurve) || c.speedCurve.length>12 || (c.speedCurve.length && c.speedCurve.length<2) || c.speedCurve.some((p,i)=>!exact(p,['frame','rate']) || !finite(p.frame,-18000,18000) || !finite(p.rate,.1,8) || (i && p.frame<=c.speedCurve[i-1].frame))))return helperEnglish('invalid_speed_curve');
    return null;
}
/** Antiderivative of a piecewise linear rate. Keys outside a trim retain the original ramp. */
export function sourceAdvance(c,frame) {
    const keys=c.speedCurve || [];
    if(!keys.length)return frame*(c.rate ?? 1);
    const primitive=t=>{
        let sum=(Math.min(t,keys[0].frame)-keys[0].frame)*keys[0].rate;
        if(t<=keys[0].frame)return sum;
        for(let i=1;i<keys.length;i++) {
            const a=keys[i-1],b=keys[i],d=Math.min(t,b.frame)-a.frame;
            sum+=a.rate*d+(b.rate-a.rate)*d*d/(2*(b.frame-a.frame));
            if(t<=b.frame)return sum;
        }
        return sum+(t-keys.at(-1).frame)*keys.at(-1).rate;
    };
    return primitive(frame)-primitive(0);
}
export const sourceFrame=(c,offset)=>c.freezeFrame ?? c.in+(c.reverse?-1:1)*sourceAdvance(c,offset);
export const shiftedSpeedKeys=(c,offset)=>c.speedCurve?.map(p=>({...p,frame:p.frame-offset}));
export const sourceRange=(c,extra=0)=>{const a=sourceFrame(c,0),b=sourceFrame(c,c.len-1+extra);return {from:Math.min(a,b),to:Math.max(a,b)};};
export const SPEED_PRESETS=Object.freeze({smooth:[{position:0,rate:1},{position:.5,rate:.5},{position:1,rate:1}],accelerate:[{position:0,rate:.5},{position:1,rate:2}],decelerate:[{position:0,rate:2},{position:1,rate:.5}],pulse:[{position:0,rate:1},{position:.25,rate:2},{position:.5,rate:.5},{position:.75,rate:2},{position:1,rate:1}]});
/** Map decoded chunks with the same source-time function as pictures. Linear PCM resampling changes pitch. */
export function remapAudio(chunks,clip,length,sampleRate=48000,signal) {
    const channels=Array.from({length:2},()=>new Float32Array(length));
    if(!chunks.length || clip.freezeFrame!==undefined)return channels;
    let index=clip.reverse?chunks.length-1:0;
    for(let n=0;n<length;n++) {
        if(n%48000===0 && signal?.aborted)throw Object.assign(new Error('Playback cancelled.'),{name:'AbortError'});
        const time=sourceFrame(clip,n/sampleRate*30)/30;
        while(index>0 && time<chunks[index].timestamp)index--;
        while(index<chunks.length-1 && time>=chunks[index+1].timestamp)index++;
        const c=chunks[index],at=(time-c.timestamp)*c.sampleRate,j=Math.floor(at),p=at-j;
        if(j<0 || j>=c.channels[0].length)continue;
        for(let ch=0;ch<2;ch++) {const samples=c.channels[Math.min(ch,c.channels.length-1)],a=samples[j],next=j+1<samples.length?samples[j+1]:chunks[index+1]?.channels[Math.min(ch,(chunks[index+1]?.channels.length || 1)-1)]?.[0] ?? a;channels[ch][n]=a+(next-a)*p;}
    }
    return channels;
}

export function speedAt(c,frame) {
    const keys=c.speedCurve || [];if(!keys.length)return c.rate ?? 1;
    const left=[...keys].reverse().find(k=>k.frame<=frame) || keys[0],right=keys.find(k=>k.frame>=frame) || keys.at(-1);
    return left.frame===right.frame?left.rate:left.rate+(right.rate-left.rate)*(frame-left.frame)/(right.frame-left.frame);
}
export function visibleSpeedPoints(c) {return [{position:0,rate:speedAt(c,0)},...(c.speedCurve || []).filter(k=>k.frame>0 && k.frame<c.len).map(k=>({position:k.frame/c.len,rate:k.rate})),{position:1,rate:speedAt(c,c.len)}];}

/** Retained remapped buffers plus the largest source decode, assuming stereo 48 kHz PCM. */
export function mappedAudioBytes(tl) {
    let retained=0,peakSource=0;
    for(const c of [...tl.video,...tl.audio]) {
        if(!tl.media[c.mediaId]?.hasAudio || c.volume===0 || c.freezeFrame!==undefined || (!c.reverse && !c.speedCurve?.length && !audioProcessingActive(c)))continue;
        const bounds=audioRange(c,60);retained+=(c.len+60)/30*48000*2*4*3;peakSource=Math.max(peakSource,(bounds.to-bounds.from+1)/30*48000*2*4*(c.audioProcessing?.noiseReduction?5:1));
    }
    return retained+peakSource;
}

export function audioRange(c,extra=0) {
    const b=sourceRange(c,extra),s=c.audioProcessing;return {from:Math.max(0,Math.min(b.from-2,s?.noiseReduction?s.noiseStart*30:Infinity)),to:Math.max(b.to+2,s?.noiseReduction?(s.noiseStart+s.noiseLength)*30:-Infinity)};
}
export function audioWorkingBytes(tl) {
    let retained=mappedAudioBytes(tl);
    for(const c of [...tl.video,...tl.audio])if(tl.media[c.mediaId]?.hasAudio && c.volume>0 && c.freezeFrame===undefined && !c.reverse && !c.speedCurve?.length && !audioProcessingActive(c))retained+=(sourceAdvance(c,c.len+60)+2)/30*48000*2*4;
    const frames=Math.max(0,...[...tl.video,...tl.audio,...tl.text].map(c=>c.start+c.len));return retained+frames/30*48000*2*4;
}
