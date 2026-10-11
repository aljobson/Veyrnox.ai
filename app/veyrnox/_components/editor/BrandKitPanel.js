'use client';
import { BrandAssetPicker } from './BrandAssetPicker';
import { useState } from 'react';
import { Button } from '../Button';
import { useEditorResource } from './useEditorResource';
import { emptyBrandKit,brandKitProblem } from '../../../../lib/editorShared';
import { TEXT_DEFAULTS } from '../../_lib/editorSequenceValidation.mjs';
import { TEXT_FONTS } from '../../_lib/editorTextStyle.mjs';
import { addSequenceText } from '../../_lib/editorSequence.mjs';
const field='w-full rounded border border-vx-border bg-vx-base p-2 text-xs';
export function BrandKitPanel({project,item,frame,disabled,apply,onSelect,onIngest}) {
    const resource=useEditorResource(project?.workspaceId?`/workspaces/${project.workspaceId}/brand-kit`:null),[draft,setDraft]=useState(null),[name,setName]=useState('Brand title'),[status,setStatus]=useState(null);
    const kit=draft?.source===resource.data?draft.kit:resource.data?.kit || emptyBrandKit(),problem=status?.source===resource.data?status.text:'';
    if(!project?.workspaceId)return <p className="text-xs">Save to a workspace project to open its brand kit.</p>;
    const locked=disabled || resource.busy || !resource.data?.canEdit;
    const set=(key,value)=>setDraft({source:resource.data,kit:{...kit,[key]:value}});
    async function save(){const bad=brandKitProblem(kit);if(bad){setStatus({source:resource.data,text:bad});return;}const result=await resource.mutate({expected_version:resource.data.version,kit},'PUT');if(result){resource.setData(result);setStatus({source:result,text:'Brand kit saved.'});}}
    return <section aria-label="Workspace brand kit" className="space-y-3"><h2 className="text-sm font-bold">Workspace brand kit</h2>
        {resource.error && <p role="alert" className="text-xs">{resource.error}</p>}{problem && <p role="status" className="text-xs">{problem}</p>}
        <fieldset disabled={locked} className="space-y-2"><label className="block text-xs">Brand name<input aria-label="Brand name" className={field} value={kit.name} maxLength={80} onChange={e=>set('name',e.target.value)} /></label>
        <label className="block text-xs">Palette colours<input aria-label="Brand palette colours" className={field} value={kit.palette.join(', ')} onChange={e=>set('palette',e.target.value.split(',').map(v=>v.trim()))} /></label>
        <p className="text-xs">Use up to 12 hex colours separated by commas.</p>
        <p className="text-xs font-bold">System fonts</p>{TEXT_FONTS.map(font=><label key={font} className="block text-xs"><input type="checkbox" aria-label={`Brand font ${font}`} checked={kit.fonts.includes(font)} onChange={e=>set('fonts',e.target.checked?[...kit.fonts,font]:kit.fonts.filter(v=>v!==font))} /> {font}</label>)}
        <input aria-label="Brand text style name" className={field} value={name} maxLength={80} onChange={e=>setName(e.target.value)} />
        <Button size="sm" disabled={!item?.text || kit.textStyles.length>=12 || !name.trim()} onClick={()=>set('textStyles',[...kit.textStyles,{name:name.trim(),size:item.size,style:{...TEXT_DEFAULTS,...item.style}}])}>Save selected text as brand style</Button>
        </fieldset>
        <div className="flex flex-wrap gap-1">{kit.palette.filter(c=>/^#[0-9a-f]{6}$/i.test(c)).map((c,i)=><button key={`${c}:${i}`} type="button" disabled={disabled || resource.busy} aria-label={`Use brand colour ${c} for canvas`} className="size-7 rounded border border-vx-border" style={{background:c}} onClick={()=>apply(t=>({...t,background:c}))} />)}</div>
        {kit.textStyles.map((preset,i)=><div key={i} className="flex gap-1"><Button size="sm" disabled={disabled || resource.busy} onClick={()=>{const next=apply(t=>addSequenceText(t,{text:preset.name,size:preset.size,style:preset.style,start:Math.min(frame,17910),len:90}));if(next)onSelect({track:'text',id:`t${next.seq}`});}}>Insert {preset.name}</Button><Button size="sm" variant="ghost" disabled={locked} aria-label={`Remove brand style ${preset.name}`} onClick={()=>set('textStyles',kit.textStyles.filter((_,j)=>j!==i))}>×</Button></div>)}
        <BrandAssetPicker key={`${project.workspaceId}:${resource.accountId}`} useDisabled={disabled || resource.busy} workspaceId={project.workspaceId} assets={kit.assets} disabled={locked} onChange={assets=>set('assets',assets)} onIngest={onIngest} />
        <Button size="sm" disabled={locked} onClick={save}>Save brand kit</Button><Button size="sm" variant="ghost" disabled={resource.busy} onClick={resource.reload}>Reload saved brand kit</Button>
        {!resource.data?.canEdit && resource.data && <p className="text-xs">You can use this kit. Editing requires a creator or editor role.</p>}
    </section>;
}
