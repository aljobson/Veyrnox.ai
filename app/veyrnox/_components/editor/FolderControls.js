'use client';
import {useState} from 'react';
import {Button} from '../Button';
import {createFolder,moveFolder,deleteEmptyFolder,folderPaths} from '../../_lib/editorOrganization.mjs';
export function FolderControls({tl,disabled,apply}){
    const [path,setPath]=useState(''),[selected,setSelected]=useState('');
    const paths=folderPaths(tl),active=paths.includes(selected)?selected:'';
    const field='w-full rounded border border-vx-border bg-vx-base p-2 text-xs';
    return <details><summary className="cursor-pointer text-xs font-bold">Organize folders</summary><fieldset disabled={disabled} className="mt-2 space-y-2">
        <label className="block text-xs">Folder path<input aria-label="Folder path" maxLength={80} value={path} onChange={e=>setPath(e.target.value)} placeholder="Campaign/Scenes" className={field} /></label>
        <Button size="sm" onClick={()=>{if(apply(t=>createFolder(t,path.trim())))setPath('');}}>Create folder</Button>
        <label className="block text-xs">Folder to organize<select aria-label="Folder to organize" value={active} onChange={e=>{setSelected(e.target.value);setPath(e.target.value);}} className={field}><option value="">Choose folder</option>{paths.map(p=><option key={p}>{p}</option>)}</select></label>
        <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!active} onClick={()=>{const next=path.trim();if(apply(t=>moveFolder(t,active,next)))setSelected(next);}}>Rename or move folder</Button><Button size="sm" variant="ghost" disabled={!active} onClick={()=>{if(apply(t=>deleteEmptyFolder(t,active))){setSelected('');setPath('');}}}>Delete empty folder</Button></div>
        <p className="text-[10px] text-vx-fg-muted">Empty folders are saved with the project. Rename or move includes child folders and media. Move media out before deleting.</p>
    </fieldset></details>;
}
