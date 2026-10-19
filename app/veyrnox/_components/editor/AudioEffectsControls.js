'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { Button } from '../Button';
import { AUDIO_EFFECT_DEFAULTS } from '../../_lib/editorAudioEffects.mjs';
import { NumberControl } from './EditorFields';
export function AudioEffectsControls({ item, media, onChange }) {
  const { t } = useI18n();
    if (!media?.hasAudio || item.freezeFrame !== undefined) return null;
    const settings = { ...AUDIO_EFFECT_DEFAULTS, ...item.audioEffects }, set = (key, value) => onChange({ audioEffects: { ...settings, [key]: value } });
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.audio.effects")}</summary><div className="mt-2 space-y-2">
        <NumberControl label={t("app.editor.audio.width")} value={settings.width * 100} min={0} max={200} step={1} onChange={n => set('width', n / 100)} />
        <p className="text-xs text-vx-fg-muted">{t("app.editor.audio.widthHelp")}</p>
        <div className="grid grid-cols-2 gap-2"><NumberControl label={t("app.editor.audio.tremoloRate")} value={settings.tremoloRate} min={.1} max={20} step={.1} onChange={n => set('tremoloRate', n)} /><NumberControl label={t("app.editor.audio.tremoloDepth")} value={settings.tremoloDepth * 100} min={0} max={100} step={1} onChange={n => set('tremoloDepth', n / 100)} /></div>
        <div className="grid grid-cols-2 gap-2"><NumberControl label={t("app.editor.audio.echoDelay")} value={settings.echoDelay} min={.01} max={1} step={.01} onChange={n => set('echoDelay', n)} /><NumberControl label={t("app.editor.audio.echoRepeats")} value={settings.echoRepeats} min={1} max={8} step={1} onChange={n => set('echoRepeats', n)} /><NumberControl label={t("app.editor.audio.echoDecay")} value={settings.echoDecay * 100} min={5} max={90} step={1} onChange={n => set('echoDecay', n / 100)} /><NumberControl label={t("app.editor.audio.echoMix")} value={settings.echoMix * 100} min={0} max={100} step={1} onChange={n => set('echoMix', n / 100)} /></div>
        <p className="text-xs text-vx-fg-muted">{t("app.editor.audio.effectsHelp")}</p>
        <Button size="sm" variant="ghost" onClick={() => onChange({ audioEffects: { ...AUDIO_EFFECT_DEFAULTS } })}>{t("app.editor.audio.effectsReset")}</Button>
    </div></details>;
}
