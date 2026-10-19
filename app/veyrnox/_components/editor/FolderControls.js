'use client';
import { storedFolderLabel } from '../../_lib/editorStoredLabels.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import {useState} from 'react';
import {Button} from '../Button';
import {createFolder,moveFolder,deleteEmptyFolder,folderPaths} from '../../_lib/editorOrganization.mjs';
export function FolderControls({tl,disabled,apply}){
  const { t } = useI18n();
    const [path,setPath]=useState(''),[selected,setSelected]=useState('');
    const paths=folderPaths(tl),active=paths.includes(selected)?selected:'';
    const field='w-full rounded border border-vx-border bg-vx-base p-2 text-xs';
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.folders.organize")}</summary><fieldset disabled={disabled} className="mt-2 space-y-2">
        <label className="block text-xs">{t("app.editor.folders.path")}<input aria-label={t("app.editor.folders.path")} maxLength={80} value={path} onChange={e=>setPath(e.target.value)} placeholder={t("app.editor.folders.example")} className={field} /></label>
        <Button size="sm" onClick={()=>{if(apply(timeline=>createFolder(timeline,path.trim())))setPath('');}}>{t("app.editor.folders.create")}</Button>
        <label className="block text-xs">{t("app.editor.folders.target")}<select aria-label={t("app.editor.folders.target")} value={active} onChange={e=>{setSelected(e.target.value);setPath(e.target.value);}} className={field}><option value="">{t("app.editor.folders.choose")}</option>{paths.map(p=><option key={p} value={p}>{storedFolderLabel(t, p)}</option>)}</select></label>
        <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!active} onClick={()=>{const next=path.trim();if(apply(timeline=>moveFolder(timeline,active,next)))setSelected(next);}}>{t("app.editor.folders.move")}</Button><Button size="sm" variant="ghost" disabled={!active} onClick={()=>{if(apply(timeline=>deleteEmptyFolder(timeline,active))){setSelected('');setPath('');}}}>{t("app.editor.folders.delete")}</Button></div>
        <p className="text-[10px] text-vx-fg-muted">{t("app.editor.folders.help")}</p>
    </fieldset></details>;
}
