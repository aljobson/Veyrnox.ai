'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { Button } from '../Button';
import { NumberControl,ColorControl } from './EditorFields';
import { SMART_PICTURE } from '../../_lib/editorSmartPicture.mjs';
export function SmartPictureControls({item,onChange}) {
  const { t } = useI18n();
    const s={...SMART_PICTURE,...item.smartPicture},set=(k,v)=>onChange({smartPicture:{...s,[k]:v}});
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.picture.title")}</summary><div className="mt-2 space-y-2">
        <NumberControl label={t("app.editor.picture.noise")} value={s.denoise} min={0} max={1} step={.05} onChange={v=>set('denoise',v)} />
        <label className="flex gap-2 text-xs"><input aria-label={t("app.editor.picture.remove")} type="checkbox" checked={s.keyEnabled} onChange={e=>set('keyEnabled',e.target.checked)} />{t("app.editor.picture.remove")}</label>
        {s.keyEnabled && <><ColorControl label={t("app.editor.picture.keyColour")} value={s.keyColor} onChange={v=>set('keyColor',v)} /><NumberControl label={t("app.editor.picture.tolerance")} value={s.keyTolerance} min={0} max={1} step={.01} onChange={v=>set('keyTolerance',v)} /><NumberControl label={t("app.editor.picture.feather")} value={s.keyFeather} min={.001} max={1} step={.01} onChange={v=>set('keyFeather',v)} /><NumberControl label={t("app.editor.picture.spill")} value={s.despill} min={0} max={1} step={.05} onChange={v=>set('despill',v)} /></>}
        <NumberControl label={t("app.editor.picture.exposure")} value={s.light} min={-2} max={2} step={.1} onChange={v=>set('light',v)} />
        {!!s.light && <><NumberControl label={t("app.editor.picture.x")} value={s.lightX} min={0} max={1} step={.01} onChange={v=>set('lightX',v)} /><NumberControl label={t("app.editor.picture.y")} value={s.lightY} min={0} max={1} step={.01} onChange={v=>set('lightY',v)} /><NumberControl label={t("app.editor.picture.radius")} value={s.lightRadius} min={.05} max={2} step={.05} onChange={v=>set('lightRadius',v)} /></>}
        <Button size="sm" variant="ghost" onClick={()=>onChange({smartPicture:{...SMART_PICTURE}})}>{t("app.editor.picture.reset")}</Button>
        <p className="text-xs text-vx-fg-muted">{t("app.editor.picture.help")}</p>
    </div></details>;
}
