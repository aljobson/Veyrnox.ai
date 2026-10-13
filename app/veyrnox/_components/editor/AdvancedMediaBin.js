'use client';
import { MediaDetails } from './MediaDetails';
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

export function MediaArtwork({ media, blobs, loaded, sourceRevision, compact = false, clip = null, pixels = 240 }) {
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
    return <div className="pointer-events-none" aria-label={`${media.name} ${media.hasAudio ? 'waveform and thumbnails' : 'thumbnails'}`} data-source-frames={clip ? frameKey : undefined}>
        {thumbnails.length > 0 && <div className="flex overflow-hidden">{thumbnails.map((url, i) => <img key={i} src={url} alt="" className={compact ? 'h-8 min-w-0 flex-1 object-cover opacity-50' : 'min-w-0 flex-1 rounded-sm object-cover'} />)}</div>}
        {peaks.length > 0 && <svg viewBox={`0 0 ${peaks.length} 30`} role="img" aria-label={`Waveform for ${media.name}`} className={compact ? 'h-6 w-full opacity-60' : 'h-8 w-full text-vx-accent'}>{peaks.map((v, i) => <path key={i} d={`M${i} ${15 - Math.max(0.5, v * 14)}V${15 + Math.max(0.5, v * 14)}`} stroke="currentColor" strokeWidth="0.7" />)}</svg>}{error && !compact && <p className="text-[10px]">Preview unavailable; source remains editable.</p>}
    </div>;
}
export function AdvancedMediaBin({ tl, blobs, loaded, disabled, apply, onFiles, onIngest, onAdd, onRemove, onRelink, onDetails, proxies, onProxy, onRemoveProxy, onError }) {
    const {organization}=useEditorCompletionFlags();
    const [folder,setFolder]=useState('*'),[search, setSearch] = useState(''), [kind, setKind] = useState('all'), [library, setLibrary] = useState(null), [source, setSource] = useState(null), [sourceUrl, setSourceUrl] = useState(null), [from, setFrom] = useState(0), [to, setTo] = useState(3), [busy, setBusy] = useState(false);
    const alive=useRef(true);
    useEffect(()=>{alive.current=true;let actor=getStoredUserId();const unsubscribe=onSessionChange(session=>{const next=session?.user?.id || null;if(next===actor)return;actor=next;setLibrary(null);setSource(null);setSourceUrl(null);setBusy(false);});return()=>{alive.current=false;unsubscribe();};},[]);
    const selected = tl.media[source], entries = matchingMedia(tl,{search,kind,folder});
    useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);
    async function openLibrary(cursor=null) {
        const account=getStoredUserId() || 'guest';setBusy(true);
        try {const page=await listEditorLibrary(gatewayFetch,{actor:account,cursor});if(alive.current && account===(getStoredUserId() || 'guest'))setLibrary(previous=>({...page,items:cursor?[...(previous?.items || []),...page.items.filter(item=>!previous?.items.some(old=>old.mediaId===item.mediaId))]:page.items}));}
        catch(e){if(alive.current && account===(getStoredUserId() || 'guest'))onError(e.status===401?'Sign in to open your Library.':e.status===429?'Library requests are busy. Retry in a minute.':'Could not load the Library. Retry when connected.');}
        finally{if(alive.current && account===(getStoredUserId() || 'guest'))setBusy(false);}
    }
    async function importLibrary(item) {
        const account=getStoredUserId() || 'guest',isCurrent=()=>alive.current && account===(getStoredUserId() || 'guest');setBusy(true);
        try {const {blob}=await loadEditorLibraryItem(gatewayFetch,item,{actor:account,isCurrent});if(!isCurrent())return;await onIngest(blob,item.label,item.mediaId);}
        catch(e){if(isCurrent())onError(e.message || 'Library import failed.');}finally{if(isCurrent())setBusy(false);}
    }
    return <div className="space-y-3"><h2 className="text-sm font-bold">Media</h2><label className="block cursor-pointer rounded-lg border border-dashed border-vx-border p-3 text-center text-xs">Upload video, image or audio<input data-testid="editor-import" aria-label="Upload video, image or audio" className="sr-only" type="file" multiple accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/mp4,image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={onFiles} /></label><Button size="sm" disabled={disabled || busy} onClick={() => openLibrary()}>Add from my Library</Button>
    <input aria-label="Search media" placeholder="Search media" className="w-full rounded border border-vx-border bg-vx-base p-2 text-xs" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Media type" className="w-full rounded bg-vx-base p-2 text-xs" value={kind} onChange={e => setKind(e.target.value)}>{['all','video','audio','image','graphic'].map(k => <option key={k}>{k}</option>)}</select>
    <select aria-label="Media folder filter" className="w-full rounded bg-vx-base p-2 text-xs" value={folder} onChange={e=>setFolder(e.target.value)}><option value="*">All folders</option><option value="">Unfiled</option>{mediaFolders(tl).map(name=><option key={name} value={name}>{name}</option>)}</select>
    {organization&&<FolderControls tl={tl} disabled={disabled} apply={apply} />}
    {library && <section aria-label="My Library" className="space-y-2"><Button size="sm" variant="ghost" onClick={() => setLibrary(null)}>Close Library</Button><p className="text-xs">Generated assets, saved edits and originals on this device.</p>{library.warnings.map(message=><p key={message} role="alert" className="text-xs">{message}</p>)}{library.warnings.length>0 && <Button size="sm" disabled={busy} onClick={()=>openLibrary()}>Retry Library</Button>}{library.items.length ? library.items.map(item => <Button key={item.mediaId} size="sm" disabled={busy || disabled} onClick={() => importLibrary(item)}>{item.kind}: {item.label} · {item.source==='device'?'This device':item.source==='editor'?'Saved edit':item.source==='master'?'Film Studio':'Generated'}</Button>) : <p className="text-xs">No finished media in your Library. Import a file from your device or generate an asset.</p>}{library.next && <Button size="sm" disabled={busy || disabled} onClick={()=>openLibrary(library.next)}>Load older generations</Button>}{busy && <p role="status" className="text-xs">Loading Library media…</p>}</section>}
    <p role="status" className="text-[10px] text-vx-fg-muted">{entries.length} matching media items</p><ul className="space-y-2">{entries.map(m => <li key={m.id} draggable={!disabled && (loaded.includes(m.id)||m.kind==='graphic')} aria-label={`Drag ${m.name} to timeline`} onDragStart={e=>{if(disabled)return;e.dataTransfer.setData('application/x-veyrnox-media',m.id);e.dataTransfer.effectAllowed='copy';}} data-testid={`media-${m.id}`} className="rounded-lg border border-vx-border p-2"><MediaArtwork media={m} blobs={blobs} loaded={loaded.includes(m.id)} sourceRevision={loaded} /><p className="truncate text-xs font-bold">{m.name}</p><p className="text-[10px] text-vx-fg-muted">{m.kind} · {formatTime(m.frames)} · {m.kind === 'graphic' ? 'Generated locally' : loaded.includes(m.id) ? 'Loaded' : 'Relink needed'}</p><p className="text-[10px] text-vx-fg-muted">{proxies.has(m.id)?'360p preview proxy · export uses original':m.folder || 'Unfiled'}</p><div className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => onAdd(m.id)}>Add to timeline</Button>{m.kind==='video' && <Button size="sm" variant="ghost" disabled={disabled || !loaded.includes(m.id)} aria-label={`${proxies.has(m.id)?'Remove':'Create'} preview proxy for ${m.name}`} onClick={()=>proxies.has(m.id)?onRemoveProxy(m.id):onProxy(m)}>{proxies.has(m.id)?'Remove proxy':'Create proxy'}</Button>}<Button size="sm" variant="ghost" disabled={disabled || !loaded.includes(m.id)} onClick={() => { setSource(m.id); setSourceUrl(URL.createObjectURL(blobs.current.get(m.id))); setFrom(0); setTo(m.frames / 30); }}>Source</Button><Button size="sm" variant="ghost" disabled={disabled} aria-label={`Edit media details for ${m.name}`} onClick={()=>{setSource(m.id);setSourceUrl(null);}}>Details</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={() => onRemove(m.id)}>Remove media</Button></div></li>)}</ul>
    {selected && <fieldset disabled={disabled}><MediaDetails media={selected} onChange={onDetails} /></fieldset>}
    {selected && sourceUrl && <section aria-label="Source viewer" className="space-y-2 rounded border border-vx-border p-2"><p className="truncate text-xs">{selected.name}</p>{selected.kind === 'video' ? <video src={sourceUrl} controls playsInline className="w-full" /> : selected.kind === 'image' ? <img src={sourceUrl} alt={selected.name} /> : <audio src={sourceUrl} controls className="w-full" />}<NumberControl label="Source in seconds" value={from} min={0} max={selected.frames / 30} onChange={setFrom} /><NumberControl label="Source out seconds" value={to} min={0} max={selected.frames / 30} onChange={setTo} /><Button size="sm" disabled={disabled} onClick={() => onAdd(source, { in: Math.round(from * 30), len: Math.round((to - from) * 30) })}>Add marked range</Button><Button size="sm" variant="ghost" onClick={() => { setSource(null); setSourceUrl(null); }}>Close source</Button></section>}
    {Object.values(tl.media).some(m => m.kind !== 'graphic' && !loaded.includes(m.id)) && <label className="block cursor-pointer text-xs underline">Relink a missing file<input aria-label="Relink a missing file" type="file" className="sr-only" accept="video/*,audio/*,image/png,image/jpeg,image/webp" disabled={disabled} onChange={onRelink} /></label>}
    </div>;
}
