import { AUDIO_DEFAULTS } from './editorAudioSettings.mjs';
import { remapAudio } from './editorSpeed.mjs';
import { stretchAudio,abortIfNeeded,yieldAudio } from './editorTimeStretch.mjs';
import { suppressNoise } from './editorNoise.mjs';
/** One processing path for transport and export; all presets are original local DSP. */
export async function processAudio(chunks,clip,length,sampleRate,signal) {
    abortIfNeeded(signal);const s={...AUDIO_DEFAULTS,...clip.audioProcessing},clean=await suppressNoise(chunks,s,sampleRate,signal),pitch=Math.max(-12,Math.min(12,s.pitch+(s.voice==='deep'?-5:s.voice==='bright'?5:0)));
    const out=clip.preservePitch||pitch?await stretchAudio(clean,clip,length,sampleRate,pitch,signal):remapAudio(clean,clip,length,sampleRate,signal);
    let envelope=0,gain=1;const threshold=10**(s.gateDb/20),attack=1-Math.exp(-1/(sampleRate*.005)),release=1-Math.exp(-1/(sampleRate*.08));
    for(let i=0;i<length;i++){
        const level=Math.sqrt((out[0][i]**2+out[1][i]**2)*.5);envelope+=(level-envelope)*(level>envelope?attack:release);const target=s.gateDb<=-96?1:Math.max(0,Math.min(1,(envelope-threshold*.5)/(threshold*.5)));gain+=(target-gain)*(target>gain?attack:release);
        for(let ch=0;ch<2;ch++){out[ch][i]*=gain;if(s.voice==='robot')out[ch][i]*=.5+.5*Math.sin(i/sampleRate*2*Math.PI*50);if(s.voice==='radio')out[ch][i]=Math.tanh(out[ch][i]*2)/Math.tanh(2);}
        if(i && i%48000===0){abortIfNeeded(signal);await yieldAudio();}
    }
    abortIfNeeded(signal);return out;
}
