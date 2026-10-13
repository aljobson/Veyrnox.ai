'use client';
import { Button } from '../Button';
import { AUDIO_EFFECT_DEFAULTS } from '../../_lib/editorAudioEffects.mjs';
import { NumberControl } from './EditorFields';
export function AudioEffectsControls({ item, media, onChange }) {
    if (!media?.hasAudio || item.freezeFrame !== undefined) return null;
    const settings = { ...AUDIO_EFFECT_DEFAULTS, ...item.audioEffects }, set = (key, value) => onChange({ audioEffects: { ...settings, [key]: value } });
    return <details><summary className="cursor-pointer text-xs font-bold">Stereo, tremolo and echo</summary><div className="mt-2 space-y-2">
        <NumberControl label="Stereo width (%)" value={settings.width * 100} min={0} max={200} step={1} onChange={n => set('width', n / 100)} />
        <p className="text-xs text-vx-fg-muted">Zero combines the channels into mono, 100 keeps the original width, and 200 doubles their difference. Mono recordings stay centered.</p>
        <div className="grid grid-cols-2 gap-2"><NumberControl label="Tremolo rate (Hz)" value={settings.tremoloRate} min={.1} max={20} step={.1} onChange={n => set('tremoloRate', n)} /><NumberControl label="Tremolo depth (%)" value={settings.tremoloDepth * 100} min={0} max={100} step={1} onChange={n => set('tremoloDepth', n / 100)} /></div>
        <div className="grid grid-cols-2 gap-2"><NumberControl label="Echo delay (seconds)" value={settings.echoDelay} min={.01} max={1} step={.01} onChange={n => set('echoDelay', n)} /><NumberControl label="Echo repeats" value={settings.echoRepeats} min={1} max={8} step={1} onChange={n => set('echoRepeats', n)} /><NumberControl label="Echo decay (%)" value={settings.echoDecay * 100} min={5} max={90} step={1} onChange={n => set('echoDecay', n / 100)} /><NumberControl label="Echo mix (%)" value={settings.echoMix * 100} min={0} max={100} step={1} onChange={n => set('echoMix', n / 100)} /></div>
        <p className="text-xs text-vx-fg-muted">Depth and mix at zero turn tremolo and echo off. Echo repeats must fit within four seconds and stop at the clip boundary. Clip fades also shape the echoes; preview before exporting.</p>
        <Button size="sm" variant="ghost" onClick={() => onChange({ audioEffects: { ...AUDIO_EFFECT_DEFAULTS } })}>Reset stereo, tremolo and echo</Button>
    </div></details>;
}
