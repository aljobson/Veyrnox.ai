export const AUDIO_DEFAULTS=Object.freeze({pitch:0,voice:'none',noiseReduction:0,noiseStart:0,noiseLength:.3,gateDb:-96});
export const VOICES=Object.freeze(['none','deep','bright','radio','robot']);
export function audioSettingsProblem(clip,media) {
    if(clip.preservePitch!==undefined && typeof clip.preservePitch!=='boolean')return 'Invalid pitch preservation setting.';
    const s=clip.audioProcessing;if(s===undefined)return null;
    if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==6||Object.keys(s).some(k=>!Object.hasOwn(AUDIO_DEFAULTS,k))||!VOICES.includes(s.voice))return 'Invalid audio processing settings.';
    for(const [key,min,max] of [['pitch',-12,12],['noiseReduction',0,1],['noiseStart',0,333333],['noiseLength',.05,2],['gateDb',-96,-6]])if(!Number.isFinite(s[key])||s[key]<min||s[key]>max)return 'Audio processing is outside its supported range.';
    if(s.noiseReduction && (!media?.hasAudio || (s.noiseStart+s.noiseLength)*30>media.frames))return 'Choose a noise-only sample within this source file.';
    return null;
}
export const audioProcessingActive=c=>!!c.preservePitch || !!(c.audioProcessing && (c.audioProcessing.pitch || c.audioProcessing.voice!=='none' || c.audioProcessing.noiseReduction || c.audioProcessing.gateDb>-96));
