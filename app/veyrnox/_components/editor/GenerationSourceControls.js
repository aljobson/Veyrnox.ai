'use client';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { useEffect,useRef } from 'react';
import { Button } from '../Button';
import { generationSlotKind,generationMimeTypes } from '../../../../lib/generationSourceSlots.mjs';
import { generationSourceLabel } from '../../_lib/editorGeneration.mjs';
function SourcePreview({source,label}) {
    const image=useRef(null);
    useEffect(()=>{if(!source.file)return;const url=URL.createObjectURL(source.file);if(image.current)image.current.src=url;return()=>URL.revokeObjectURL(url);},[source.file]);
    return source.file||source.previewUrl?<img ref={image} src={source.file?undefined:source.previewUrl} alt={`${label}: ${source.label}`} className="max-h-20 rounded border border-vx-border"/>:null;
}
export function GenerationSourceControls({model,sources,onFile,onLibrary,onClear}) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale), {useGrouping:false, maximumFractionDigits:20}).format(value);
    return Object.entries(model?.media||{}).map(([slot,spec])=>{
        const sourceLabel=generationSourceLabel(model,slot),label=tOr(t,`app.editor.sources.label.${sourceLabel}`,sourceLabel),source=sources[slot],kind=generationSlotKind(slot);
        return <div key={slot} className="space-y-1 text-xs"><p>{label}{spec.required?t("app.editor.sources.required"):t("app.editor.sources.optional")}{spec.maxSeconds?t("app.editor.sources.max",{n:number(spec.maxSeconds)}):''}</p>
            {source&&kind==='image'&&<SourcePreview source={source} label={label}/>}
            {source&&<p aria-label={t("app.editor.sources.selection",{label})}>{source.label} · {source.file?t("app.editor.sources.device"):t("label.Library")}</p>}
            <label className="block">{t("app.editor.sources.chooseDevice",{label:locale === 'en' ? label.toLowerCase() : label})}<input aria-label={t("app.editor.sources.chooseDevice",{label})} type="file" accept={generationMimeTypes(kind).join(',')} className="block w-full text-xs" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(slot,file);}}/></label>
            <Button size="sm" variant="ghost" aria-label={t("app.editor.sources.chooseLibrary",{label})} onClick={()=>onLibrary(slot)}>{t("app.editor.sources.libraryButton",{label:locale === 'en' ? label.toLowerCase() : label})}</Button>
            {source&&<Button size="sm" variant="ghost" onClick={()=>onClear(slot)}>{t("app.editor.sources.clear",{label:locale === 'en' ? label.toLowerCase() : label})}</Button>}
        </div>;
    });
}
