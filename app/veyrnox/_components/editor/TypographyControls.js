'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { TEXT_EXTRAS } from '../../_lib/editorTextStyle.mjs';
import { NumberControl,ColorControl } from './EditorFields';
export function TypographyControls({style,onChange}) {
  const { t } = useI18n();
    const s={...TEXT_EXTRAS,...style},set=(key,value)=>onChange({...s,[key]:value});
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.typography.title")}</summary><div className="mt-2 space-y-2">
        {Object.keys({italic:0,underline:0}).map(key=><label key={key} className="flex items-center gap-2 text-xs"><input aria-label={key==='italic'?t("app.editor.typography.italicLabel"):t("app.editor.typography.underlineLabel")} type="checkbox" checked={s[key]} onChange={e=>set(key,e.target.checked)} />{key==='italic'?t("app.editor.typography.italic"):t("app.editor.typography.underline")}</label>)}
        <NumberControl label={t("app.editor.typography.spacing")} value={s.letterSpacing} min={-10} max={30} onChange={n=>set('letterSpacing',n)} /><NumberControl label={t("app.editor.typography.lineHeight")} value={s.lineHeight} min={.8} max={3} onChange={n=>set('lineHeight',n)} />
        <ColorControl label={t("app.editor.typography.colour")} value={s.shadowColor} onChange={v=>set('shadowColor',v)} /><NumberControl label={t("app.editor.typography.opacity")} value={s.shadowOpacity*100} min={0} max={100} onChange={n=>set('shadowOpacity',n/100)} />
        <NumberControl label={t("app.editor.typography.blur")} value={s.shadowBlur} min={0} max={30} onChange={n=>set('shadowBlur',n)} />
        <NumberControl label={t("app.editor.typography.x")} value={s.shadowX} min={-50} max={50} onChange={n=>set('shadowX',n)} /><NumberControl label={t("app.editor.typography.y")} value={s.shadowY} min={-50} max={50} onChange={n=>set('shadowY',n)} />
        <p className="text-xs text-vx-fg-muted">{t("app.editor.typography.help")}</p>
    </div></details>;
}
