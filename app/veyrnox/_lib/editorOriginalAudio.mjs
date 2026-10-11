// Original procedural sounds. Version 1 synthesis is fixed so saved timelines reopen with the same samples.
const music=(id,title,bpm,notes,tags)=>({id,title,category:'Music',seconds:16*60/bpm,bpm,notes,tags});
const fx=(id,title,seconds,mode,tags)=>({id,title,category:'Sound effects',seconds,mode,tags});
export const ORIGINAL_AUDIO=Object.freeze([
    music('soft-keys','Soft keys',96,[60,64,67,71,57,60,64,69,53,57,60,65,55,59,62,67],'calm piano warm'),
    music('bright-pluck','Bright pluck',120,[60,67,64,72,57,64,60,69,53,60,57,65,55,62,59,67],'upbeat pluck bright'),
    music('night-pulse','Night pulse',110,[48,55,60,55,45,52,57,52,41,48,53,48,43,50,55,50],'electronic pulse rhythmic'),
    music('slow-bells','Slow bells',80,[72,76,79,76,69,72,76,72,65,69,72,69,67,71,74,71],'ambient bells calm'),
    fx('glass-shimmer','Glass shimmer',2,'bell','transition sparkle chime'),
    fx('rising-sweep','Rising sweep',3,'rise','transition whoosh build'),
    fx('falling-sweep','Falling sweep',2,'fall','transition whoosh descending'),
    fx('soft-impact','Soft impact',1,'impact','hit drum cinematic'),
    fx('gentle-notice','Gentle notice',1,'notice','notification alert gentle'),
    fx('tap-click','Tap click',.2,'click','button interface tap'),
]);
export const originalAudioPreset=id=>ORIGINAL_AUDIO.find(p=>p.id===id);
export function originalAudioProblem(source){return source===undefined?null:(!source || Array.isArray(source) || Object.keys(source).length!==2 || source.version!==1 || !originalAudioPreset(source.presetId))?'Invalid original audio source.':null;}
export function synthesizeOriginalAudio(id,sampleRate=48000){
    const preset=originalAudioPreset(id);if(!preset || !Number.isInteger(sampleRate) || sampleRate<8000 || sampleRate>48000)throw new Error('Choose an original sound and a supported sample rate.');
    const out=new Float32Array(Math.round(preset.seconds*sampleRate));let random=0x13579bdf;
    const noise=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/2147483648-1;};
    for(let i=0;i<out.length;i++){
        const t=i/sampleRate,p=t/preset.seconds,fade=Math.min(1,t/.012,(preset.seconds-t)/.06);let v=0;
        if(preset.category==='Music'){
            const beat=t*preset.bpm/60,index=Math.min(15,Math.floor(beat)),age=(beat-index)*60/preset.bpm,f=440*2**((preset.notes[index]-69)/12),decay=Math.exp(-age*(id==='slow-bells'?3:6));
            v=.2*(Math.sin(2*Math.PI*f*age)+.25*Math.sin(2*Math.PI*f*2*age))*decay;
            if(id==='night-pulse')v+=.13*Math.sin(2*Math.PI*(50*age+50*(1-Math.exp(-age*12))/12))*Math.exp(-age*14);
        }else if(preset.mode==='bell')v=.22*(Math.sin(2*Math.PI*880*t)+.3*Math.sin(2*Math.PI*1320*t))*Math.exp(-t*3);
        else if(preset.mode==='notice'){const age=t% .5;v=.18*Math.sin(2*Math.PI*(t<.5?660:880)*age)*Math.exp(-age*7);}
        else if(preset.mode==='impact')v=(.28*Math.sin(2*Math.PI*(45*t+90*(1-Math.exp(-t*12))/12))+.07*noise())*Math.exp(-t*8);
        else if(preset.mode==='click')v=(.18*noise()+.12*Math.sin(2*Math.PI*1500*t))*Math.exp(-t*65);
        else {const phase=preset.mode==='rise'?120*t+400*t*t:1200*t-200*t*t;v=(.14*Math.sin(2*Math.PI*phase)+.035*noise())*Math.sin(Math.PI*p);}
        out[i]=fade>0?Math.tanh(v)*fade:0;
    }
    return out;
}
export function originalAudioBlob(id){
    const rate=48000,samples=synthesizeOriginalAudio(id,rate),bytes=new ArrayBuffer(44+samples.length*2),view=new DataView(bytes);
    const ascii=(at,text)=>{for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i));};
    ascii(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,samples.length*2,true);
    for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.round(samples[i]*32767),true);
    return new Blob([bytes],{type:'audio/wav'});
}
export function restoreOriginalAudio(timeline,blobs){for(const m of Object.values(timeline.media)){if(m.originalAudio && !blobs.has(m.id) && !originalAudioProblem(m.originalAudio))blobs.set(m.id,originalAudioBlob(m.originalAudio.presetId));}}
