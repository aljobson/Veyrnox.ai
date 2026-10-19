'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { Button } from '../Button';
import { AUDIO_DEFAULTS,VOICES } from '../../_lib/editorAudioSettings.mjs';
import { NumberControl,SelectControl } from './EditorFields';
export function AudioProcessingControls({item,media,onChange,onAll}) {
  const { t } = useI18n();
    const s={...AUDIO_DEFAULTS,...item.audioProcessing},set=(key,value)=>onChange({audioProcessing:{...s,[key]:value}});
    if(!media.hasAudio || item.freezeFrame!==undefined)return null;
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.audio.processing")}</summary><div className="mt-2 space-y-2">
        <label className="flex gap-2 text-xs"><input aria-label={t("app.editor.audio.preserve")} type="checkbox" checked={!!item.preservePitch} onChange={e=>onChange({preservePitch:e.target.checked})} />{t("app.editor.audio.preserve")}</label>
        <SelectControl label={t("app.editor.audio.voicePreset")} value={s.voice} options={VOICES} onChange={v=>set('voice',v)} /><NumberControl label={t("app.editor.audio.pitch")} value={s.pitch} min={-12} max={12} step={1} onChange={n=>set('pitch',n)} />
        <NumberControl label={t("app.editor.audio.noise")} value={s.noiseReduction*100} min={0} max={100} onChange={n=>set('noiseReduction',n/100)} />
        <NumberControl label={t("app.editor.audio.noiseStart")} value={s.noiseStart} min={0} max={media.frames/30} onChange={n=>set('noiseStart',n)} /><NumberControl label={t("app.editor.audio.noiseLength")} value={s.noiseLength} min={.05} max={2} onChange={n=>set('noiseLength',n)} />
        <p className="text-xs text-vx-fg-muted">{t("app.editor.audio.noiseHelp")}</p>
        <NumberControl label={t("app.editor.audio.gate")} value={s.gateDb} min={-96} max={-6} step={1} onChange={n=>set('gateDb',n)} /><p className="text-xs text-vx-fg-muted">{t("app.editor.audio.gateHelp")}</p>
        <Button size="sm" onClick={()=>onAll(s)}>{t("app.editor.audio.apply")}</Button><Button size="sm" variant="ghost" onClick={()=>onChange({audioProcessing:{...AUDIO_DEFAULTS},preservePitch:false})}>{t("app.editor.audio.reset")}</Button>
    </div></details>;
}
