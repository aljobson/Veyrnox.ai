'use client';
import { originalFolder, ORIGINAL_CREDIT, ORIGINAL_USAGE } from '../../_lib/editorStoredLabels.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey, tOr } from '../../../../lib/i18n/translate.mjs';
import { useEffect,useRef,useState } from 'react';
import { Button } from '../Button';
import { ORIGINAL_AUDIO,originalAudioBlob } from '../../_lib/editorOriginalAudio.mjs';
const AUDIO_CATEGORIES = ['All', ...new Set(ORIGINAL_AUDIO.map(item => item.category))];
export function OriginalAudioPanel({disabled,onIngest}){
  const { t, locale } = useI18n();
    const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
    const categoryLabel = value => tOr(t, `app.editor.original.category.${value}`, value);
    const [search,setSearch]=useState(''),[category,setCategory]=useState('All'),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),alive=useRef(true);
    useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
    const entries=ORIGINAL_AUDIO.filter(p=>(category==='All' || p.category===category) && `${p.title} ${p.tags}`.toLowerCase().includes(search.toLowerCase()));
    const open=p=>{const blob=originalAudioBlob(p.id);setPreview({url:URL.createObjectURL(blob),title:p.title,id:p.id});};
    async function insert(p){setBusy(true);setError('');try{await onIngest(new File([originalAudioBlob(p.id)],`${p.id}.wav`,{type:'audio/wav'}),p.title,undefined,undefined,{originalAudio:{version:1,presetId:p.id},sourceName:`${p.id}.wav`,folder:originalFolder(p.category),attribution:{credit:ORIGINAL_CREDIT,usage:ORIGINAL_USAGE,url:''}});}catch(e){if(alive.current)setError(e.message || t("app.editor.original.failed"));}finally{if(alive.current)setBusy(false);}}
    return <section aria-label={t("app.editor.original.catalog")} className="space-y-3"><h2 className="text-sm font-bold">{t("app.editor.original.title")}</h2><p className="text-xs text-vx-fg-muted">{t("app.editor.original.help")}</p>
        <input aria-label={t("app.editor.original.search")} className="w-full rounded border border-vx-border bg-vx-base p-2 text-xs" value={search} onChange={e=>setSearch(e.target.value)} /><select aria-label={t("app.editor.original.category")} className="w-full rounded bg-vx-base p-2 text-xs" value={category} onChange={e=>setCategory(e.target.value)}>{AUDIO_CATEGORIES.map(item=><option key={item} value={item}>{categoryLabel(item)}</option>)}</select>
        {error && <p role="alert" className="text-xs">{error}</p>}{busy && <p role="status" className="text-xs">{t("app.editor.original.inserting")}</p>}
        {preview && <div className="rounded border border-vx-border p-2"><p className="text-xs">{preview.title}</p><audio aria-label={t("app.editor.original.preview")} src={preview.url} controls className="w-full" /><a className="text-xs underline" download={`${preview.id}.wav`} href={preview.url}>{t("app.editor.original.download")}</a></div>}
        <p role="status" className="text-xs">{t(pluralKey(t, locale, 'app.editor.original.count', entries.length), {count: number(entries.length)})}</p>{entries.map(p=><div key={p.id} className="space-y-1 rounded border border-vx-border p-2"><h3 className="text-xs font-bold">{p.title}</h3><p className="text-[10px] text-vx-fg-muted">{categoryLabel(p.category)} · {locale === 'en' ? p.seconds.toFixed(1) : new Intl.NumberFormat(localeTag(locale), {minimumFractionDigits:1,maximumFractionDigits:1}).format(p.seconds)}s{p.bpm?t('app.editor.original.bpm', {count: number(p.bpm)}):''}</p><Button size="sm" variant="ghost" aria-label={t('app.editor.original.previewName', {name: p.title})} disabled={disabled || busy} onClick={()=>open(p)}>{t("app.editor.workspace.preview")}</Button><Button size="sm" aria-label={t('app.editor.original.insertName', {name: p.title})} disabled={disabled || busy} onClick={()=>insert(p)}>{t("app.editor.pack.insert")}</Button></div>)}
    </section>;
}
