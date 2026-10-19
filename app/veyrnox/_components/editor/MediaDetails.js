'use client';
import { storedFolderLabel, storedAttributionLabel } from '../../_lib/editorStoredLabels.mjs';
import { useI18n } from '../../../../components/I18nProvider';
export function MediaDetails({media,onChange}) {
  const { t } = useI18n();
    const field='w-full rounded border border-vx-border bg-vx-base p-2 text-xs',note=media.attribution||{credit:'',usage:'',url:''};
    const input=(label,value,max,onCommit,displayValue=value)=><label className="block text-xs">{label}<input aria-label={label} key={`${media.id}:${label}:${value}`} defaultValue={displayValue} maxLength={max} className={field} onBlur={e=>{if(e.target.value!==displayValue)onCommit(e.target.value);}} /></label>;
    return <section aria-label={t("app.editor.details.title")} className="space-y-2 rounded border border-vx-border p-2"><h3 className="text-xs font-bold">{t("app.editor.details.title")}</h3>
        {input(t("app.editor.details.name"),media.name,120,name=>onChange(media.id,{name:name.trim()}))}{input(t("app.editor.details.folder"),media.folder||'',80,folder=>onChange(media.id,{folder:folder.trim()}),storedFolderLabel(t,media.folder||''))}
        <p className="break-words text-xs text-vx-fg-muted">{t("app.editor.details.original",{name:media.sourceName||media.name})}</p>
        <details><summary className="cursor-pointer text-xs">{t("app.editor.details.rights")}</summary><div className="mt-2 space-y-2">
            {input(t("app.editor.details.credit"),note.credit,120,credit=>onChange(media.id,{attribution:{...note,credit}}),storedAttributionLabel(t,note.credit))}{input(t("app.editor.details.usage"),note.usage,240,usage=>onChange(media.id,{attribution:{...note,usage}}),storedAttributionLabel(t,note.usage))}{input(t("app.editor.details.url"),note.url,1000,url=>onChange(media.id,{attribution:{...note,url}}))}
            {note.url && <a href={note.url} target="_blank" rel="noopener noreferrer" className="text-xs text-vx-accent underline">{t("app.editor.details.open")}</a>}
        </div></details>
    </section>;
}
