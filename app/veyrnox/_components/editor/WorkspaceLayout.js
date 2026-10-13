'use client';
import { Button } from '../Button';
export const WORKSPACE_LAYOUT=Object.freeze({mediaDock:'left',inspector:true,inspectorWidth:260,previewHeight:55,timelineHeight:180});
export function workspaceColumns(layout,binWidth) {
    const media=layout.mediaDock==='hidden'?[]:[`${binWidth}px`],inspector=layout.inspector?[`${layout.inspectorWidth}px`]:[];
    return (layout.mediaDock==='right'?[...inspector,'minmax(0,1fr)',...media]:[...media,'minmax(0,1fr)',...inspector]).join(' ');
}
export function WorkspaceLayout({layout,onChange,compact=false}) {
    const set=(key,value)=>onChange({...layout,[key]:value});
    return <details className={`relative shrink-0 rounded-lg border border-vx-border ${compact?'bg-vx-base/60 px-3 py-2':'p-2'}`}><summary className="cursor-pointer list-none text-xs font-semibold [&::-webkit-details-marker]:hidden">Workspace</summary><div className={`${compact?'absolute right-0 top-full z-50 mt-2 w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-vx-border bg-vx-panel p-4 shadow-2xl':'mt-2'} flex flex-wrap items-center gap-3 text-xs`}>
        <label>Media panel position<select aria-label="Media panel position" className="ml-2 rounded border border-vx-border bg-vx-base p-1" value={layout.mediaDock} onChange={e=>set('mediaDock',e.target.value)}>{['left','right','hidden'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label className="flex gap-2"><input aria-label="Show inspector" type="checkbox" checked={layout.inspector} onChange={e=>set('inspector',e.target.checked)} />Inspector</label>
        <label>Inspector width<input aria-label="Inspector panel width" type="range" min={220} max={400} value={layout.inspectorWidth} onChange={e=>set('inspectorWidth',Number(e.target.value))} /></label>
        <label>Preview height<input aria-label="Preview panel height" type="range" min={30} max={75} value={layout.previewHeight} onChange={e=>set('previewHeight',Number(e.target.value))} /></label>
        <label>Timeline height<input aria-label="Timeline panel height" type="range" min={140} max={720} value={layout.timelineHeight} onChange={e=>set('timelineHeight',Number(e.target.value))} /></label>
        <Button size="sm" onClick={()=>onChange({...layout,mediaDock:'hidden',inspector:false,previewHeight:70})}>Focus preview</Button><Button size="sm" variant="ghost" onClick={()=>onChange({...WORKSPACE_LAYOUT})}>Reset workspace layout</Button>
    </div></details>;
}
