'use client';
import { storedFolderLabel } from '../../_lib/editorStoredLabels.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { pluralKey, tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
const MEDIA_VIEWS = ['all', 'favorites', 'recent'];
const MEDIA_KINDS = ['all', 'video', 'audio', 'image', 'graphic'];
import { MediaDetails } from './MediaDetails';
import { LibraryGrid } from './LibraryGrid';
import {FolderControls} from './FolderControls';
import {useEditorCompletionFlags} from './CompletionFlags';
import { mediaFolders,matchingMedia } from '../../_lib/editorMediaDetails.mjs';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { getStoredUserId,onSessionChange } from '../../../lib/authClient';
import { NumberControl } from './EditorControls';
import { acquireMediaAnalysis, acquireTimelineFilmstrip } from '../../_lib/editorAnalysis.mjs';
import { timelineThumbnailFrames, timelineWaveform, mediaWaveform } from '../../_lib/editorTimelineArtwork.mjs';
import { useLocalMediaBlob } from './useLocalMediaBlob';
import { formatTime } from '../../_lib/editorTimeline.mjs';
import { listEditorLibrary, loadEditorLibraryItem } from '../../_lib/editorLibraryCollection.mjs';
import { gatewayFetch } from '../../_lib/gateway';
import { emptyMediaPreferences,noteRecentMedia,readMediaPreferences,toggleMediaFavorite,writeMediaPreferences } from '../../_lib/editorMediaPreferences.mjs';

export function MediaArtwork({ media, blobs, loaded, sourceRevision, compact = false, clip = null, pixels = 240 }) {
  const { t } = useI18n();
    const [analysis, setAnalysis] = useState(null), [filmstrip, setFilmstrip] = useState(null), [error, setError] = useState(false);
    const blob = useLocalMediaBlob(blobs, media.id, sourceRevision ?? loaded);
    const frames = clip ? timelineThumbnailFrames(media, clip, pixels) : [], frameKey = frames.join(',');
    useEffect(() => {
        if (!blob && media.kind !== 'graphic') return;
        let active = true; const lease = acquireMediaAnalysis(media, blob);
        lease.ready.then(value => { if (active) { setAnalysis({ media, blob, value }); setError(false); } }, e => { if (active && e.name !== 'AbortError') setError(true); });
        return () => { active = false; lease.release(); };
    }, [media, blob]);
    useEffect(() => {
        if (!blob || media.kind !== 'video' || !frameKey) return;
        let active = true; const lease = acquireTimelineFilmstrip(media, blob, frameKey.split(',').map(Number));
        lease.ready.then(value => { if (active) setFilmstrip({ frameKey, media, blob, value }); }, e => { if (active && e.name !== 'AbortError') setError(true); });
        return () => { active = false; lease.release(); };
    }, [media, blob, frameKey]);
    const art = analysis?.media === media && analysis.blob === blob ? analysis.value : null;
    const thumbnails = clip && media.kind === 'video' ? (filmstrip?.frameKey === frameKey && filmstrip.media === media && filmstrip.blob === blob ? filmstrip.value.thumbnails : []) : art?.thumbnails || [];
    const peaks = clip ? timelineWaveform(art?.peaks, media, clip, pixels) : mediaWaveform(art?.peaks, media);
    return <div className="pointer-events-none" aria-label={t(media.hasAudio ? 'app.editor.media.artAudio' : 'app.editor.media.art', { name: media.name })} data-source-frames={clip ? frameKey : undefined}>
        {thumbnails.length > 0 && <div className="flex overflow-hidden">{thumbnails.map((url, i) => <img key={i} src={url} alt="" className={compact ? 'h-8 min-w-0 flex-1 object-cover opacity-50' : 'min-w-0 flex-1 rounded-sm object-cover'} />)}</div>}
        {peaks.length > 0 && <svg viewBox={`0 0 ${peaks.length} 30`} role="img" aria-label={t('app.editor.media.waveform', { name: media.name })} className={compact ? 'h-6 w-full opacity-60' : 'h-8 w-full text-vx-accent'}>{peaks.map((v, i) => <path key={i} d={`M${i} ${15 - Math.max(0.5, v * 14)}V${15 + Math.max(0.5, v * 14)}`} stroke="currentColor" strokeWidth="0.7" />)}</svg>}{error && !compact && <p className="text-xs">{t("app.editor.media.previewUnavailable")}</p>}
    </div>;
}
export function AdvancedMediaBin({ tl, blobs, loaded, disabled, selectedClip, apply, onFiles, onIngest, onAdd, onReplace, onRemove, onRelink, onDetails, proxies, onProxy, onRemoveProxy, onError }) {
  const { t, locale } = useI18n();
    const {organization}=useEditorCompletionFlags();
    const [folder,setFolder]=useState('*'),[search, setSearch] = useState(''), [kind, setKind] = useState('all'),[view,setView]=useState('all'),[preferences,setPreferences]=useState(emptyMediaPreferences), [library, setLibrary] = useState(null), [source, setSource] = useState(null), [sourceUrl, setSourceUrl] = useState(null), [from, setFrom] = useState(0), [to, setTo] = useState(3), [busy, setBusy] = useState(false);
    const alive=useRef(true);
    useEffect(()=>{alive.current=true;let actor=getStoredUserId() || 'guest';queueMicrotask(()=>{if(alive.current)setPreferences(readMediaPreferences(window.localStorage,actor));});const unsubscribe=onSessionChange(session=>{const next=session?.user?.id || 'guest';if(next===actor)return;actor=next;setLibrary(null);setSource(null);setSourceUrl(null);setBusy(false);setPreferences(readMediaPreferences(window.localStorage,actor));});return()=>{alive.current=false;unsubscribe();};},[]);
    const selected = tl.media[source], matched = matchingMedia(tl,{search,kind,folder}), entries = view==='favorites'?matched.filter(item=>preferences.favorites.includes(item.id)):view==='recent'?[...matched].sort((a,b)=>preferences.recent.indexOf(a.id)-preferences.recent.indexOf(b.id)).filter(item=>preferences.recent.includes(item.id)):matched;
    const changePreferences=operation=>setPreferences(value=>writeMediaPreferences(window.localStorage,getStoredUserId() || 'guest',operation(value)));
    const recordMediaUse=(id,operation)=>{changePreferences(value=>noteRecentMedia(value,id));operation(id);};
    useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);
    async function openLibrary(cursor=null) {
        const account=getStoredUserId() || 'guest';setBusy(true);
        try {const page=await listEditorLibrary(gatewayFetch,{actor:account,cursor});if(alive.current && account===(getStoredUserId() || 'guest'))setLibrary(previous=>({...page,items:cursor?[...(previous?.items || []),...page.items.filter(item=>!previous?.items.some(old=>old.mediaId===item.mediaId))]:page.items}));}
        catch(e){if(alive.current && account===(getStoredUserId() || 'guest'))onError(e.status===401?t("app.editor.media.signIn"):e.status===429?t("app.editor.media.busy"):t("app.editor.media.loadFailed"));}
        finally{if(alive.current && account===(getStoredUserId() || 'guest'))setBusy(false);}
    }
    async function importLibrary(item) {
        const account=getStoredUserId() || 'guest',isCurrent=()=>alive.current && account===(getStoredUserId() || 'guest');setBusy(true);
        try {const {blob}=await loadEditorLibraryItem(gatewayFetch,item,{actor:account,isCurrent});if(!isCurrent())return;await onIngest(blob,item.label,item.mediaId);}
        catch(e){if(isCurrent())onError(tOr(t, `app.editor.media.error.${e.code}`, t('app.editor.media.importFailed')));}finally{if(isCurrent())setBusy(false);}
    }
    return <div className="space-y-3"><h2 className="text-sm font-bold">{t("app.publish.composer.media")}</h2><label className="block cursor-pointer rounded-lg border border-dashed border-vx-border p-3 text-center text-xs">{t("app.editor.media.upload")}<input data-testid="editor-import" aria-label={t("app.editor.media.upload")} className="sr-only" type="file" multiple accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/mp4,image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={onFiles} /></label><Button size="sm" disabled={disabled || busy} onClick={() => openLibrary()}>{t("app.editor.legacy.addLibrary")}</Button>
    <div className="flex gap-1" aria-label={t("app.editor.media.views")}>{MEDIA_VIEWS.map(name=><button key={name} type="button" aria-pressed={view===name} className={`min-h-9 rounded-full border px-3 text-xs font-bold capitalize ${view===name?'border-vx-accent text-vx-accent':'border-vx-border text-vx-fg-muted'}`} onClick={()=>setView(name)}>{t(`app.editor.media.view.${name}`)}</button>)}</div>
    <input aria-label={t("app.editor.media.search")} placeholder={t("app.editor.media.search")} className="w-full rounded border border-vx-border bg-vx-base p-2 text-xs" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label={t("app.publish.composer.mediaType")} className="w-full rounded bg-vx-base p-2 text-xs" value={kind} onChange={e => setKind(e.target.value)}>{MEDIA_KINDS.map(k => <option key={k} value={k}>{k === 'all' ? t('app.editor.media.view.all') : t(`app.editor.media.kind.${k}`)}</option>)}</select>
    <select aria-label={t("app.editor.media.folders")} className="w-full rounded bg-vx-base p-2 text-xs" value={folder} onChange={e=>setFolder(e.target.value)}><option value="*">{t("app.editor.media.allFolders")}</option><option value="">{t("app.editor.media.unfiled")}</option>{mediaFolders(tl).map(name=><option key={name} value={name}>{storedFolderLabel(t, name)}</option>)}</select>
    {organization&&<FolderControls tl={tl} disabled={disabled} apply={apply} />}
    {library && <section aria-label={t("app.editor.legacy.myLibrary")} className="space-y-2"><Button size="sm" variant="ghost" onClick={() => setLibrary(null)}>{t("app.editor.media.closeLibrary")}</Button><p className="text-xs">{t("app.editor.media.libraryContents")}</p>{library.warnings.map(message=><p key={message} role="alert" className="text-xs">{message}</p>)}{library.warnings.length>0 && <Button size="sm" disabled={busy} onClick={()=>openLibrary()}>{t("public.LibraryPicker.retryLibrary")}</Button>}{library.items.length ? <LibraryGrid items={library.items} disabled={busy || disabled} onPick={importLibrary} /> : <p className="text-xs">{t("app.editor.media.empty")}</p>}{library.next && <Button size="sm" disabled={busy || disabled} onClick={()=>openLibrary(library.next)}>{t("app.editor.media.older")}</Button>}{busy && <p role="status" className="text-xs">{t("app.editor.media.loading")}</p>}</section>}
    <p role="status" className="text-xs text-vx-fg-muted">{t(pluralKey(t, locale, 'app.editor.media.matches', entries.length), { count: locale === 'en' ? String(entries.length) : entries.length.toLocaleString(localeTag(locale)) })}</p><ul className="space-y-2">{entries.map(m => {const replaceable=selectedClip && tl.media[selectedClip.item.mediaId]?.kind===m.kind && selectedClip.item.mediaId!==m.id,favorite=preferences.favorites.includes(m.id);return <li key={m.id} draggable={!disabled && (loaded.includes(m.id)||m.kind==='graphic')} aria-label={t('app.editor.media.drag', { name: m.name })} onDragStart={e=>{if(disabled)return;e.dataTransfer.setData('application/x-veyrnox-media',m.id);e.dataTransfer.effectAllowed='copy';}} data-testid={`media-${m.id}`} className="rounded-lg border border-vx-border p-2"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><MediaArtwork media={m} blobs={blobs} loaded={loaded.includes(m.id)} sourceRevision={loaded} /><p className="truncate text-xs font-bold">{m.name}</p></div><button type="button" aria-pressed={favorite} aria-label={t(favorite ? 'app.editor.media.favoriteRemove' : 'app.editor.media.favoriteAdd', { name: m.name })} className="min-h-9 min-w-9 rounded-full border border-vx-border text-base" onClick={()=>changePreferences(value=>toggleMediaFavorite(value,m.id))}>{favorite?'★':'☆'}</button></div><p className="text-xs text-vx-fg-muted">{tOr(t, `app.editor.media.kind.${m.kind}`, m.kind)} · {formatTime(m.frames)} · {m.kind === 'graphic' ? t("app.editor.media.local") : loaded.includes(m.id) ? t("app.editor.media.loaded") : t("app.editor.media.relinkNeeded")}</p><p className="text-xs text-vx-fg-muted">{proxies.has(m.id)?t("app.editor.media.proxyInfo"):storedFolderLabel(t, m.folder || '') || t("app.editor.media.unfiled")}</p><div className="flex flex-wrap gap-1"><Button size="sm" disabled={disabled || busy} onClick={() => recordMediaUse(m.id,onAdd)}>{t("app.editor.media.addTimeline")}</Button>{selectedClip&&<Button size="sm" variant="ghost" disabled={disabled || busy || !replaceable} aria-label={t('app.editor.media.replaceLabel', { name: m.name })} onClick={()=>recordMediaUse(m.id,onReplace)}>{t("app.editor.media.replace")}</Button>}{m.kind==='video' && <Button size="sm" variant="ghost" disabled={disabled || !loaded.includes(m.id)} aria-label={t(proxies.has(m.id) ? 'app.editor.media.proxyRemoveLabel' : 'app.editor.media.proxyCreateLabel', { name: m.name })} onClick={()=>proxies.has(m.id)?onRemoveProxy(m.id):onProxy(m)}>{proxies.has(m.id)?t("app.editor.media.proxyRemove"):t("app.editor.media.proxyCreate")}</Button>}<Button size="sm" variant="ghost" disabled={disabled || !loaded.includes(m.id)} onClick={() => { setSource(m.id); setSourceUrl(URL.createObjectURL(blobs.current.get(m.id))); setFrom(0); setTo(m.frames / 30); }}>{t("app.editor.media.source")}</Button><Button size="sm" variant="ghost" disabled={disabled} aria-label={t('app.editor.media.detailsLabel', { name: m.name })} onClick={()=>{setSource(m.id);setSourceUrl(null);}}>{t("app.editor.media.details")}</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={() => onRemove(m.id)}>{t("app.editor.media.remove")}</Button></div></li>;})}</ul>
    {selected && <fieldset disabled={disabled}><MediaDetails media={selected} onChange={onDetails} /></fieldset>}
    {selected && sourceUrl && <section aria-label={t("app.editor.media.viewer")} className="space-y-2 rounded border border-vx-border p-2"><p className="truncate text-xs">{selected.name}</p>{selected.kind === 'video' ? <video src={sourceUrl} controls playsInline className="w-full" /> : selected.kind === 'image' ? <img src={sourceUrl} alt={selected.name} /> : <audio src={sourceUrl} controls className="w-full" />}<NumberControl label={t("app.editor.media.sourceIn")} value={from} min={0} max={selected.frames / 30} onChange={setFrom} /><NumberControl label={t("app.editor.media.sourceOut")} value={to} min={0} max={selected.frames / 30} onChange={setTo} /><Button size="sm" disabled={disabled} onClick={() => onAdd(source, { in: Math.round(from * 30), len: Math.round((to - from) * 30) })}>{t("app.editor.media.addRange")}</Button><Button size="sm" variant="ghost" onClick={() => { setSource(null); setSourceUrl(null); }}>{t("app.editor.media.closeSource")}</Button></section>}
    {Object.values(tl.media).some(m => m.kind !== 'graphic' && !loaded.includes(m.id)) && <label className="block cursor-pointer text-xs underline">{t("app.editor.media.relink")}<input aria-label={t("app.editor.media.relink")} type="file" className="sr-only" accept="video/*,audio/*,image/png,image/jpeg,image/webp" disabled={disabled} onChange={onRelink} /></label>}
    </div>;
}
