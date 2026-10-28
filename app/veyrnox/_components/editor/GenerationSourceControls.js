'use client';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { tOr, pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { useEffect,useRef } from 'react';
import { Button } from '../Button';
import { generationSlotKind,sourceList,publicSlotMax } from '../../../../lib/generationSourceSlots.mjs';
import { pickerAccept } from '../../../../lib/uploadInputTypes.mjs';
import { generationSourceLabel } from '../../_lib/editorGeneration.mjs';
function SourcePreview({source,label}) {
    const image=useRef(null);
    useEffect(()=>{if(!source.file)return;const url=URL.createObjectURL(source.file);if(image.current)image.current.src=url;return()=>URL.revokeObjectURL(url);},[source.file]);
    return source.file||source.previewUrl?<img ref={image} src={source.file?undefined:source.previewUrl} alt={`${label}: ${source.label}`} className="max-h-20 rounded border border-vx-border"/>:null;
}
export function GenerationSourceControls({model,sources,onFile,onLibrary,onClear,onReorder, converting = {} }) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale), {useGrouping:false, maximumFractionDigits:20}).format(value);
    return Object.entries(model?.media||{}).map(([slot,spec])=>{
        const sourceLabel=generationSourceLabel(model,slot),label=tOr(t,`app.editor.sources.label.${sourceLabel}`,sourceLabel),files=sourceList(sources[slot]),kind=generationSlotKind(slot);
        if (publicSlotMax(spec) === 1 && files.length <= 1) {
            const source = files[0];
        return <div key={slot} className="space-y-1 text-xs"><p>{label}{spec.required?t("app.editor.sources.required"):t("app.editor.sources.optional")}{spec.maxSeconds?t("app.editor.sources.max",{n:number(spec.maxSeconds)}):''}</p>
            {source&&kind==='image'&&<SourcePreview source={source} label={label}/>}
            {source&&<p aria-label={t("app.editor.sources.selection",{label})}>{source.label} · {source.file?t("app.editor.sources.device"):t("label.Library")}</p>}
            <label className="block">{t("app.editor.sources.chooseDevice",{label:locale === 'en' ? label.toLowerCase() : label})}<input aria-label={t("app.editor.sources.chooseDevice",{label})} type="file" accept={pickerAccept(kind)} disabled={Boolean(converting[slot])} className="block w-full text-xs" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(slot,file);}}/></label>
            <Button size="sm" variant="ghost" aria-label={t("app.editor.sources.chooseLibrary",{label})} onClick={()=>onLibrary(slot)}>{t("app.editor.sources.libraryButton",{label:locale === 'en' ? label.toLowerCase() : label})}</Button>
            {source&&<Button size="sm" variant="ghost" onClick={()=>onClear(slot)}>{t("app.editor.sources.clear",{label:locale === 'en' ? label.toLowerCase() : label})}</Button>}
        </div>;
        }
        return <div key={slot} className="space-y-1 text-xs"><p>{label}{spec.required?t("app.editor.sources.required"):t("app.editor.sources.optional")}{spec.maxSeconds?t("app.editor.sources.max",{n:number(spec.maxSeconds)}):''}</p>
            {publicSlotMax(spec) > 1 && <p>{t(pluralKey(t, locale, 'app.create.sources.maxFiles', publicSlotMax(spec)),{count:number(publicSlotMax(spec))})}</p>}
            {files.length>publicSlotMax(spec)&&<p role="alert">{t(pluralKey(t, locale, 'app.create.sources.overLimit', publicSlotMax(spec)),{count:number(publicSlotMax(spec))})}</p>}
            {files.map((source,index)=><div key={index}>
            {source&&kind==='image'&&<SourcePreview source={source} label={label}/>}
            {source&&<p aria-label={t("app.editor.sources.selection",{label})}>{source.label} · {source.file?t("app.editor.sources.device"):t("label.Library")}</p>}
            <Button size="sm" variant="ghost" onClick={()=>onClear(slot,index)}>{t('app.publish.smartlink.remove')}</Button>
            {index>0&&<Button size="sm" aria-label={t('app.create.sources.moveEarlier')} onClick={()=>onReorder(slot,index,index-1)}>↑</Button>}
            {index<files.length-1&&<Button size="sm" aria-label={t('app.create.sources.moveLater')} onClick={()=>onReorder(slot,index,index+1)}>↓</Button>}
            </div>)}
            {(files.length<publicSlotMax(spec)||publicSlotMax(spec)===1)&&<div>
            <label className="block">{t("app.editor.sources.chooseDevice",{label:locale === 'en' ? label.toLowerCase() : label})}<input aria-label={t("app.editor.sources.chooseDevice",{label})} type="file" accept={pickerAccept(kind)} disabled={Boolean(converting[slot])} className="block w-full text-xs" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(slot,file);}}/></label>
            <Button size="sm" variant="ghost" aria-label={t("app.editor.sources.chooseLibrary",{label})} onClick={()=>onLibrary(slot)}>{t("app.editor.sources.libraryButton",{label:locale === 'en' ? label.toLowerCase() : label})}</Button>
            </div>}

        </div>;
    });
}
