'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { Button } from '../Button';
export const WORKSPACE_LAYOUT=Object.freeze({mediaDock:'left',inspector:true,inspectorWidth:260,previewHeight:55,timelineHeight:180});
export function workspaceColumns(layout,binWidth) {
    const media=layout.mediaDock==='hidden'?[]:[`${binWidth}px`],inspector=layout.inspector?[`${layout.inspectorWidth}px`]:[];
    return (layout.mediaDock==='right'?[...inspector,'minmax(0,1fr)',...media]:[...media,'minmax(0,1fr)',...inspector]).join(' ');
}
export function WorkspaceLayout({layout,onChange,compact=false}) {
  const { t } = useI18n();
    const set=(key,value)=>onChange({...layout,[key]:value});
    return <details className={`relative shrink-0 rounded-lg border border-vx-border ${compact?'bg-vx-base/60 px-3 py-2':'p-2'}`}><summary className="cursor-pointer list-none whitespace-nowrap text-xs font-semibold [&::-webkit-details-marker]:hidden"><span className="sm:hidden">{t("app.library.layout")}</span><span className="hidden sm:inline">{t("app.projects.workspace")}</span></summary><div className={`${compact?'absolute end-0 top-full z-50 mt-2 w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-vx-border bg-vx-panel p-4 shadow-2xl':'mt-2'} flex flex-wrap items-center gap-3 text-xs`}>
        <label>{t("app.editor.layout.position")}<select aria-label={t("app.editor.layout.position")} className="ms-2 rounded border border-vx-border bg-vx-base p-1" value={layout.mediaDock} onChange={e=>set('mediaDock',e.target.value)}>{Object.keys({left:0,right:0,hidden:0}).map(value=><option key={value} value={value}>{t(`app.editor.layout.${value}`)}</option>)}</select></label>
        <label className="flex gap-2"><input aria-label={t("app.editor.layout.show")} type="checkbox" checked={layout.inspector} onChange={e=>set('inspector',e.target.checked)} />{t("app.editor.workspace.inspector")}</label>
        <label>{t("app.editor.layout.inspectorWidth")}<input aria-label={t("app.editor.layout.inspectorLabel")} type="range" min={220} max={400} value={layout.inspectorWidth} onChange={e=>set('inspectorWidth',Number(e.target.value))} /></label>
        <label>{t("app.editor.layout.previewHeight")}<input aria-label={t("app.editor.layout.previewLabel")} type="range" min={30} max={75} value={layout.previewHeight} onChange={e=>set('previewHeight',Number(e.target.value))} /></label>
        <label>{t("app.editor.layout.timelineHeight")}<input aria-label={t("app.editor.layout.timelineLabel")} type="range" min={140} max={720} value={layout.timelineHeight} onChange={e=>set('timelineHeight',Number(e.target.value))} /></label>
        <Button size="sm" onClick={()=>onChange({...layout,mediaDock:'hidden',inspector:false,previewHeight:70})}>{t("app.editor.layout.focus")}</Button><Button size="sm" variant="ghost" onClick={()=>onChange({...WORKSPACE_LAYOUT})}>{t("app.editor.layout.reset")}</Button>
    </div></details>;
}
