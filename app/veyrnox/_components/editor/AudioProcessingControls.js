'use client';
import { Button } from '../Button';
import { AUDIO_DEFAULTS,VOICES } from '../../_lib/editorAudioSettings.mjs';
import { NumberControl,SelectControl } from './EditorFields';
export function AudioProcessingControls({item,media,onChange,onAll}) {
    const s={...AUDIO_DEFAULTS,...item.audioProcessing},set=(key,value)=>onChange({audioProcessing:{...s,[key]:value}});
    if(!media.hasAudio || item.freezeFrame!==undefined)return null;
    return <details><summary className="cursor-pointer text-xs font-bold">Voice and noise processing</summary><div className="mt-2 space-y-2">
        <label className="flex gap-2 text-xs"><input aria-label="Preserve pitch when changing speed" type="checkbox" checked={!!item.preservePitch} onChange={e=>onChange({preservePitch:e.target.checked})} />Preserve pitch when changing speed</label>
        <SelectControl label="Voice preset" value={s.voice} options={VOICES} onChange={v=>set('voice',v)} /><NumberControl label="Voice pitch (semitones)" value={s.pitch} min={-12} max={12} step={1} onChange={n=>set('pitch',n)} />
        <NumberControl label="Noise reduction (%)" value={s.noiseReduction*100} min={0} max={100} onChange={n=>set('noiseReduction',n/100)} />
        <NumberControl label="Noise sample source start (seconds)" value={s.noiseStart} min={0} max={media.frames/30} onChange={n=>set('noiseStart',n)} /><NumberControl label="Noise sample length (seconds)" value={s.noiseLength} min={.05} max={2} onChange={n=>set('noiseLength',n)} />
        <p className="text-xs text-vx-fg-muted">For noise reduction, choose a source section containing background noise alone. Speech or music in the sample can be removed from the result. Preview before applying it.</p>
        <NumberControl label="Noise gate threshold (dB)" value={s.gateDb} min={-96} max={-6} step={1} onChange={n=>set('gateDb',n)} /><p className="text-xs text-vx-fg-muted">At −96 dB the gate is off. Raising it suppresses sound below the threshold. Deep/bright voices adjust pitch; radio and robot add original effects.</p>
        <Button size="sm" onClick={()=>onAll(s)}>Apply voice and gate to all sound clips</Button><Button size="sm" variant="ghost" onClick={()=>onChange({audioProcessing:{...AUDIO_DEFAULTS},preservePitch:false})}>Reset voice processing</Button>
    </div></details>;
}
