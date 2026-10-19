'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { Button } from '../Button';
import { BACKGROUND_DEFAULTS } from '../../_lib/editorBackground.mjs';
import { NumberControl,SelectControl,ColorControl } from './EditorFields';
export function BackgroundControls({item,media,onChange,onAll}) {
  const { t } = useI18n();
    const b={...BACKGROUND_DEFAULTS,...item.background},images=Object.values(media).filter(m=>['image','graphic'].includes(m.kind));
    const change=(key,value)=>onChange({background:{...b,[key]:value,...(key==='type'?{mediaId:value==='image'?(images[0]?.id || ''):''}:{})}});
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.background.title")}</summary><div className="mt-2 space-y-2">
        <SelectControl label={t("app.editor.background.clip")} value={b.type} options={['none','solid','blur',...(images.length?['image']:[])]} onChange={v=>change('type',v)} />
        {b.type!=='none' && <ColorControl label={t("app.editor.background.color")} value={b.color} onChange={v=>change('color',v)} />}
        {b.type==='blur' && <NumberControl label={t("app.editor.background.blur")} value={b.blur} min={0} max={60} step={1} onChange={v=>change('blur',v)} />}
        {b.type==='image' && <label className="block text-xs">{t("app.editor.background.image")}<select aria-label={t("app.editor.background.image")} className="w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs" value={b.mediaId} onChange={e=>change('mediaId',e.target.value)}>{images.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
        {!images.length && <p className="text-xs text-vx-fg-muted">{t("app.editor.background.import")}</p>}
        <Button size="sm" onClick={()=>onAll(b)}>{t("app.editor.background.apply")}</Button>
        <p className="text-xs text-vx-fg-muted">{t("app.editor.background.help")}</p>
    </div></details>;
}
