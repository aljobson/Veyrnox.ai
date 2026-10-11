import { sourceFrame,speedAt } from './editorSpeed.mjs';
export const abortIfNeeded=signal=>{if(signal?.aborted)throw Object.assign(new Error('Audio processing cancelled.'),{name:'AbortError'});};
export const yieldAudio=()=>new Promise(resolve=>setTimeout(resolve,0));
/** Linear, boundary-aware source sampler shared by grain matching and packing. */
export function audioSampler(chunks) {
    let index=0;
    return (time,channel=0)=>{
        if(!chunks.length)return 0;
        while(index>0 && time<chunks[index].timestamp)index--;
        while(index<chunks.length-1 && time>=chunks[index+1].timestamp)index++;
        const c=chunks[index],samples=c.channels[Math.min(channel,c.channels.length-1)],at=(time-c.timestamp)*c.sampleRate,j=Math.floor(at),p=at-j;
        if(j<0||j>=samples.length)return 0;
        const next=j+1<samples.length?samples[j+1]:chunks[index+1]?.channels[Math.min(channel,(chunks[index+1]?.channels.length||1)-1)]?.[0]??samples[j];
        return samples[j]+(next-samples[j])*p;
    };
}
/** Similarity-aligned overlap-add: source anchors follow the video map; grain pitch is independent of anchor spacing. */
export async function stretchAudio(chunks,clip,length,sampleRate,semitones=0,signal) {
    abortIfNeeded(signal);
    const out=[new Float32Array(length),new Float32Array(length)],weight=new Float32Array(length),sample=audioSampler(chunks);
    const size=2048,hop=512,half=size/2,window=Float64Array.from({length:size},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(size-1))),direction=clip.reverse?-1:1;
    const pitch=2**(semitones/12),search=Math.round(sampleRate*.005),min=Math.min(sourceFrame(clip,0),sourceFrame(clip,(length-1)/sampleRate*30))/30,max=Math.max(sourceFrame(clip,0),sourceFrame(clip,(length-1)/sampleRate*30))/30+1/sampleRate;
    const bounded=(time,ch)=>time<min||time>max?0:sample(time,ch);
    let grain=0;
    for(let center=0;center<length+half;center+=hop) {
        abortIfNeeded(signal);
        const offset=Math.min(length-1,center)/sampleRate*30,anchor=sourceFrame(clip,offset)/30,stride=direction*pitch*(clip.preservePitch?1:speedAt(clip,offset)),begin=center-half;
        let best=0,score=-Infinity;
        if(center>0 && begin+size-hop<length) {
            const correlate=delta=>{let cross=0,energy=0,reference=0;
                for(let j=0;j<size-hop;j+=8){const dest=begin+j;if(dest<0||dest>=length||!weight[dest])continue;const time=anchor+(j-half)*stride/sampleRate+delta/sampleRate,al=out[0][dest]/weight[dest],ar=out[1][dest]/weight[dest],bl=bounded(time,0),br=bounded(time,1);cross+=al*bl+ar*br;energy+=bl*bl+br*br;reference+=al*al+ar*ar;}
                return energy>1e-12&&reference>1e-12?cross/Math.sqrt(energy*reference):-Infinity;};
            for(let delta=-search;delta<=search;delta+=8){const s=correlate(delta);if(s>score+1e-6 || (Math.abs(s-score)<1e-6 && Math.abs(delta)<Math.abs(best))){score=s;best=delta;}}
            const coarse=best;for(let delta=Math.max(-search,coarse-7);delta<=Math.min(search,coarse+7);delta++){const s=correlate(delta);if(s>score+1e-6 || (Math.abs(s-score)<1e-6 && Math.abs(delta)<Math.abs(best))){score=s;best=delta;}}
        }
        for(let j=0;j<size;j++){const dest=begin+j;if(dest<0||dest>=length)continue;const w=window[j],time=anchor+(j-half)*stride/sampleRate+best/sampleRate;weight[dest]+=w;for(let ch=0;ch<2;ch++)out[ch][dest]+=bounded(time,ch)*w;}
        if(++grain%32===0)await yieldAudio();
    }
    for(let n=0;n<length;n++)if(weight[n])for(let ch=0;ch<2;ch++)out[ch][n]/=weight[n];
    abortIfNeeded(signal);return out;
}
