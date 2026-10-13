'use client';
import { saveDeviceLibrary, loadDeviceLibrary } from '../../_lib/deviceLibrary.mjs';
import { librarySourceFromId } from '../../_lib/editorLibraryCollection.mjs';
import { CommandIcon } from './CommandIcon';
import { EditorToolRail } from './EditorToolRail';
import { OriginalAudioPanel } from './OriginalAudioPanel';
import { restoreOriginalAudio } from '../../_lib/editorOriginalAudio.mjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { selectionMembers, linkedSelection, copySelection, pasteSelection, groupSelection, deleteSelection, moveSelection, reorderSequenceTrack } from '../../_lib/editorSelection.mjs';
import { Button } from '../Button';
import { Logo } from '../Logo';
import { ProjectBar } from './ProjectBar';
import { ProjectFileControls } from './ProjectFileControls';
import { GenerationPanel } from './GenerationPanel';
import { AdvancedMediaBin } from './AdvancedMediaBin';
import { matchLocalFile } from '../../_lib/editorProject.mjs';
import { ExportPanel } from './ExportPanel';
import { CatalogPanel } from './CatalogPanel';
import { CaptionPanel } from './CaptionPanel';
import { FilterPanel } from './FilterPanel';
import { TranscriptPanel } from './TranscriptPanel';
import { AnimationCatalogPanel } from './AnimationCatalogPanel';
import { TextStyleCatalog } from './TextStyleCatalog';
import { getStoredUserId,onSessionChange } from '../../../lib/authClient';
import { BrandKitPanel } from './BrandKitPanel';
import { ReviewPanel } from './ReviewPanel';
import { useEditorSharedEnabled } from './SharedToolsFlag';
import { SmartPictureControls } from './SmartPictureControls';
import { AssetPackPanel } from './AssetPackPanel';
import { MotionProcessingControls } from './MotionProcessingControls';
import {PersonProcessingControls} from './PersonProcessingControls';
import {useLocalMediaBlob} from './useLocalMediaBlob';
import {CustomFontPanel} from './CustomFontPanel';
import {useEditorCompletionFlags} from './CompletionFlags';
import {createFontRegistry,missingCustomFont} from '../../_lib/editorCustomFonts.mjs';
import { WorkspaceLayout,WORKSPACE_LAYOUT,workspaceColumns } from './WorkspaceLayout';
import { createPreviewProxy,proxyCacheProblem } from '../../_lib/editorProxy.mjs';
import { AudioProcessingControls } from './AudioProcessingControls';
import { AudioEffectsControls } from './AudioEffectsControls';
import { AUDIO_DEFAULTS } from '../../_lib/editorAudioSettings.mjs';
import { parameterKeyframe } from '../../_lib/editorAnimation.mjs';
import { BackgroundControls } from './BackgroundControls';
import { SpeedControls } from './SpeedControls';
import { VisualControls, SoundControls, TextControls, NumberControl } from './EditorControls';
import { CanvasHandles } from './CanvasHandles';
import { TrackTimeline } from './TrackTimeline';
import { EditorTransport } from './EditorTransport';
import { ShortcutGuide } from './ShortcutGuide';
import { emptySequence, upgradeSequence, sequenceEnd, SEQUENCE_MAX, addSequenceMedia, addSequenceClip, addSequenceText, addSequenceTrack, removeSequenceTrack, updateSequenceTrack, moveSequence, trimSequence, splitSequenceClip, updateSequenceClip, trackFor, removeSequenceMedia, setSequenceRate, setSequenceSpeedCurve, reverseSequenceClip, insertSequenceFreeze, extractSequenceAudio, updateMediaDetails } from '../../_lib/editorSequence.mjs';
import { validateSequence } from '../../_lib/editorSequenceValidation.mjs';
import { createHistory, commitHistory, undoHistory, redoHistory, retainedMedia } from '../../_lib/editorHistory.mjs';
import { checkLocalFile, probeMedia, checkProbe, mediaFromProbe, localMediaId } from '../../_lib/editorMedia.mjs';
import { createPreviewer } from '../../_lib/editorPreview.mjs';
import { createAudioPlayer } from '../../_lib/editorPlayback.mjs';
import { timelineSize } from '../../_lib/editorRender.mjs';
import { exportBlocker, exportTimeline, exportFileName } from '../../_lib/editorExport.mjs';
import { fitTimelineZoom, stepTimelineZoom } from '../../_lib/editorTransport.mjs';
const field = 'w-full rounded-lg border border-vx-border bg-vx-base p-2 text-sm';
const EDITOR_PALETTE={
    '--vx-base':'13 14 18','--vx-panel':'23 24 29','--vx-border':'47 49 57','--vx-border-boost':'74 77 88','--vx-field':'108 111 124',
    '--vx-fg':'244 245 247','--vx-fg-body':'211 213 220','--vx-fg-muted':'160 163 174','--vx-fg-faint':'132 135 146','--vx-accent':'62 230 196','--vx-accent-hover':'111 242 216','--vx-accent-ink':'6 35 31',
    '--vx-money':'228 169 60','--vx-money-ink':'35 23 3','--vx-danger':'255 92 71','--vx-danger-ink':'40 6 2','--vx-warn':'139 167 255'
};
export function MultitrackWorkspace({ onCredits }) {
    const {organization,localInference}=useEditorCompletionFlags(),fontRegistry=useRef(null);
    const sharedTools=useEditorSharedEnabled(),[projectContext,setProjectContext]=useState(null);
    const [fitScreen,setFitScreen]=useState(true);
    const [layout,setLayout]=useState({...WORKSPACE_LAYOUT});
    const [proxies,setProxies]=useState(()=>new Map()),[proxyJob,setProxyJob]=useState(null),[previewStatus,setPreviewStatus]=useState({sources:[]}),proxyGeneration=useRef(0),sourceGeneration=useRef(0),privateSession=useRef(false);
    const [history, setHistory] = useState(() => createHistory(emptySequence())), ref = useRef(history);
    const tl = history.now, total = sequenceEnd(tl), blobs = useRef(new Map()), canvas = useRef(null), preview = useRef(null), player = useRef(null), abort = useRef(null), alive = useRef(true), request = useRef(0);
    const [frame, setFrame] = useState(0), [selected, setSelected] = useState(null), [selection, setSelection] = useState([]), [clipboard, setClipboard] = useState(null), [playing, setPlaying] = useState(false), [preparing, setPreparing] = useState(false), [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false), [progress, setProgress] = useState(0), [result, setResult] = useState(null), [tick, setTick] = useState(0), [loaded, setLoaded] = useState([]);
    const [ppf, setPpf] = useState(2), [timelineViewport,setTimelineViewport]=useState(800),[shortcuts,setShortcuts]=useState(false), [snap, setSnap] = useState(true), [ripple, setRipple] = useState('none'), [binWidth, setBinWidth] = useState(320), [panel, setPanel] = useState('Media'), [height, setHeight] = useState(720), [blocker, setBlocker] = useState(''), [exportName, setExportName] = useState('veyrnox-studio-edit');
    const size = useMemo(() => timelineSize(tl, 720), [tl]), item = selected ? tl[selected.track]?.find(c => c.id === selected.id) : null;
    const selectedBlob=useLocalMediaBlob(blobs,item?.mediaId,loaded);
    useEffect(()=>{fontRegistry.current=createFontRegistry();return()=>fontRegistry.current.clear();},[]);
    const pause = useCallback(() => { request.current++; player.current?.stop(); setPlaying(false); setPreparing(false); }, []);
    const replace = useCallback(next => { ref.current = next; setHistory(next); }, []);
    const apply = useCallback(operation => {
        if (abort.current) return null;
        const next = operation(ref.current.now); if (next?.error) { setNotice(next.error); return null; }
        const bad = validateSequence(next); if (bad) { setNotice(bad); return null; }
        pause(); setNotice(''); setResult(null); replace(commitHistory(ref.current, next)); return next;
    }, [pause, replace]);
    const load = useCallback(next => { sourceGeneration.current++;privateSession.current=Object.values(next.media).some(m=>m.assetSource || m.id.startsWith('j-') || librarySourceFromId(m.id));restoreOriginalAudio(next,blobs.current);setLoaded([...blobs.current.keys()]); abort.current?.abort();proxyGeneration.current++;setProxies(new Map());setPreviewStatus({sources:[]}); pause(); preview.current?.dispose(); preview.current = null; replace(createHistory(upgradeSequence(next))); setSelected(null); setSelection([]); setClipboard(null); setFrame(0); setResult(null); }, [pause, replace]);
    const loadProjectFile = useCallback(next => {
        if (projectContext?.id) return false;
        const remap = new Map(), media = {};
        const sameSource = (a, b) => a && b && ['kind', 'frames', 'width', 'height', 'sourceName', 'name'].every(key => a[key] === b[key]);
        for (const [id, source] of Object.entries(next.media)) {
            const mapped = blobs.current.has(id) && !sameSource(tl.media[id], source) ? localMediaId() : id;
            remap.set(id, mapped); media[mapped] = mapped === id ? source : { ...source, id: mapped };
        }
        const imported = { ...next, media, video: next.video.map(clip => ({ ...clip, mediaId: remap.get(clip.mediaId) })), audio: next.audio.map(clip => ({ ...clip, mediaId: remap.get(clip.mediaId) })) };
        sourceGeneration.current++; privateSession.current = Object.values(imported.media).some(m => m.assetSource || m.id.startsWith('j-') || librarySourceFromId(m.id));
        restoreOriginalAudio(imported, blobs.current); setLoaded([...blobs.current.keys()]); abort.current?.abort(); proxyGeneration.current++; setProxies(new Map()); setPreviewStatus({ sources: [] }); pause(); preview.current?.dispose(); preview.current = null;
        replace(commitHistory(ref.current, imported)); setSelected(null); setSelection([]); setClipboard(null); setFrame(0); setResult(null); setNotice('');
        return true;
    }, [pause, projectContext?.id, replace, tl.media]);
    useEffect(()=>{let actor=getStoredUserId();return onSessionChange(session=>{const next=session?.user?.id || null;if(next===actor)return;actor=next;sourceGeneration.current++;fontRegistry.current?.clear();setTick(n=>n+1);if(privateSession.current){blobs.current.clear();load(emptySequence());setNotice('Account changed. Reopen sources from your current account.');}});},[load]);
    const relinked = useCallback(() => {proxyGeneration.current++;setProxies(new Map()); preview.current?.dispose(); preview.current = null; setLoaded([...blobs.current.keys()]); setTick(n => n + 1); }, []);
    useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort(); preview.current?.dispose(); preview.current = null; player.current?.dispose(); player.current = null; }; }, []);
    useEffect(() => { exportBlocker().then(reason => alive.current && setBlocker(reason || '')); }, []);
    useEffect(() => { const ids = retainedMedia(history); for (const id of Object.keys(clipboard?.media || {})) ids.add(id); for (const id of blobs.current.keys()) if (!ids.has(id)) blobs.current.delete(id); preview.current?.retain(ids, new Set(history.now.video.map(c => c.id))); }, [history, clipboard]);
    useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
    useEffect(() => { if (!canvas.current) return; preview.current ||= createPreviewer(blobs.current,proxies); const engine=preview.current;engine.draw(tl, Math.min(frame, Math.max(0, total - 1)), canvas.current).then(painted=>{if(painted && alive.current && engine===preview.current){const next=engine.status();setPreviewStatus(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);}}).catch(() => setNotice('A frame could not be decoded. Relink the source file.')); }, [tl, frame, total, tick,proxies]);
    useEffect(() => { if (!playing) return; let raf; const advance = () => { const at = player.current.frame(); setFrame(Math.min(at, total - 1)); if (at >= total) pause(); else raf = requestAnimationFrame(advance); }; raf = requestAnimationFrame(advance); return () => cancelAnimationFrame(raf); }, [playing, pause, total]);
    const seek = at => { pause(); setFrame(Math.max(0, Math.min(at, Math.max(0, total - 1)))); };
    async function play() {
        if (playing || preparing) { pause(); return; }
        player.current ||= createAudioPlayer(); const ticket = ++request.current, at = frame >= total - 1 ? 0 : frame; setFrame(at); setPreparing(true);
        try { if (await player.current.start(tl, blobs.current, at) && alive.current && ticket === request.current) setPlaying(true); }
        catch (e) { if (ticket === request.current && e.name !== 'AbortError') setNotice(e.message); }
        finally { if (ticket === request.current) setPreparing(false); }
    }
    function travel(operation) { pause(); setResult(null); replace(operation(ref.current)); setSelected(null); setSelection([]); }
    const add = (mediaId, options = {}) => apply(t => addSequenceClip(t, t.media[mediaId].kind === 'audio' ? 'audio' : 'video', mediaId, options));
    async function ingest(file, name = file.name, id = localMediaId(), assetSource,details = {}) {
        const epoch=sourceGeneration.current,scoped=assetSource || id.startsWith('j-') || librarySourceFromId(id),account=scoped?(getStoredUserId() || 'guest'):null;
        const probe = await probeMedia(file);if(!alive.current || epoch!==sourceGeneration.current)throw new Error('The edit changed. Retry the source in the current edit.');if(scoped && account!==(getStoredUserId() || 'guest'))throw new Error('The account changed. Retry the source from the current account.'); const problem = checkProbe(probe); if (problem) throw new Error(problem);
        const media = {...mediaFromProbe(id, name, probe),...details,...(assetSource?{assetSource}:{})};
        const next = apply(t => { const withMedia = addSequenceMedia(t, media); if (withMedia.error) return withMedia; const inserted = addSequenceClip(withMedia, media.kind === 'audio' ? 'audio' : 'video', media.id); return inserted.error ? withMedia : inserted; });
        if (!next) throw new Error('This file could not be added within the project limits.');
        if (next) {if(scoped)privateSession.current=true;blobs.current.set(media.id, file); setLoaded([...blobs.current.keys()]); setTick(n => n + 1); }
    }
    async function files(event) {
        const chosen = [...event.target.files]; event.target.value = ''; setBusy(true);
        for (const file of chosen) { const bad = checkLocalFile(file).error; if (bad) { setNotice(bad); continue; } try { const actor=getStoredUserId() || 'guest',probe=await probeMedia(file);const problem=checkProbe(probe);if(problem)throw new Error(problem);let saved,storageError;try{saved=await saveDeviceLibrary(actor,file,probe,{isCurrent:()=>alive.current && actor===(getStoredUserId() || 'guest')});}catch(e){storageError=e.message;}if(actor!==(getStoredUserId() || 'guest'))throw new Error('The account changed. Retry from the current account.');await ingest(file,file.name,saved?.mediaId || localMediaId());setNotice(saved?'Original saved in Library on this device.':`Imported for this edit only. ${storageError}`); } catch (e) { setNotice(e.message || 'Import failed.'); } }
        if (alive.current) setBusy(false);
    }
    useEffect(()=>{
        const id=new URLSearchParams(window.location.search).get('device');if(!id)return;
        let current=true;const actor=getStoredUserId() || 'guest';
        void loadDeviceLibrary(actor,id,{isCurrent:()=>current && actor===(getStoredUserId() || 'guest')}).then(({blob,label})=>current && ingest(blob,label,`d-${id}`)).catch(e=>current && setNotice(e.message));
        return()=>{current=false;};
        // The URL names a one-time device import; editing state must not restart it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    },[]);
    async function relink(event) { const file = event.target.files[0]; event.target.value = ''; if (!file) return; setBusy(true); try { const bad = checkLocalFile(file).error; if (bad) throw new Error(bad); const probe = await probeMedia(file), problem = checkProbe(probe); if (problem) throw new Error(problem); const match = matchLocalFile(ref.current.now, file, probe, new Set(blobs.current.keys())); if (!match) throw new Error('Choose the original file with the same name, media type and duration.'); blobs.current.set(match.id, file); setNotice(''); relinked(); } catch (e) { setNotice(e.message); } finally { if (alive.current) setBusy(false); } }
    function selectClip(value, extend = false) {
        const linked = linkedSelection(ref.current.now, value);
        const next = extend ? selection.some(s => s.id === value.id) ? selection.filter(s => !linked.some(l => l.id === s.id)) : [...selection, ...linked.filter(l => !selection.some(s => s.id === l.id))] : linked;
        setSelection(next); setSelected(next.some(s => s.id === value.id) ? value : next.at(-1) || null);
    }
    function insertCopies(source, at) {
        const before = new Set(['video', 'audio', 'text'].flatMap(kind => ref.current.now[kind].map(c => c.id)));
        const next = apply(t => pasteSelection(t, source, at));
        if (next) { const added = ['video', 'audio', 'text'].flatMap(track => next[track].filter(c => !before.has(c.id)).map(c => ({ track, id: c.id }))); setSelection(added); setSelected(added[0] || null); }
    }
    const members = selectionMembers(tl, selection), selectionLocked = members.some(c => trackFor(tl, c)?.locked);
    const duplicate = () => { if (members.length) insertCopies(copySelection(tl, selection), Math.max(...members.map(c => c.start + c.len))); };
    const remove = () => { if (apply(t => deleteSelection(t, selection, ripple==='none'?false:ripple==='all'?'all':true))) { setSelected(null); setSelection([]); } };
    const paste = () => insertCopies(clipboard, frame);
    const fitTimeline=()=>setPpf(fitTimelineZoom(total,timelineViewport));
    async function createProxy(media) {
        if(busy || exporting)return;const controller=new AbortController(),epoch=proxyGeneration.current;abort.current=controller;pause();setBusy(true);setNotice('');setProxyJob({id:media.id,progress:0});
        try{const blob=await createPreviewProxy(media,blobs.current,{signal:controller.signal,onProgress:p=>alive.current&&setProxyJob({id:media.id,progress:p.done/p.total})});if(controller.signal.aborted || epoch!==proxyGeneration.current)return;const problem=proxyCacheProblem(proxies,media.id,blob);if(problem)throw new Error(problem);preview.current?.dispose();preview.current=null;setProxies(new Map([...proxies,[media.id,blob]]));setTick(n=>n+1);}
        catch(e){if(e.name!=='AbortError'&&alive.current)setNotice(e.message||'Preview proxy failed.');}
        finally{if(abort.current===controller)abort.current=null;if(alive.current){setBusy(false);setProxyJob(null);}}
    }
    function removeProxy(id){preview.current?.dispose();preview.current=null;setProxies(current=>new Map([...current].filter(([key])=>key!==id)));setTick(n=>n+1);}
    async function runExport(options = {}) {
        const fontProblem=missingCustomFont(ref.current.now,fontRegistry.current);if(fontProblem){setNotice(fontProblem);return;}
        const controller = new AbortController(); abort.current = controller; pause(); setResult(null); setExporting(true); setProgress(0); setNotice('');
        try { const blob = await exportTimeline(ref.current.now, blobs.current, { ...options, signal: controller.signal, height, onProgress: p => alive.current && setProgress(p.done / p.total) }); if (alive.current) setResult({ blob, url: URL.createObjectURL(blob), name: exportFileName(exportName, options.format), size: blob.size }); }
        catch (e) { if (e.name !== 'AbortError') setNotice(e.message || 'Export failed.'); }
        finally { abort.current = null; if (alive.current) setExporting(false); }
    }
    function keys(event) {
        if (busy || exporting || event.target.closest('input, textarea, select, [contenteditable]')) return;
        const mod = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
        if (mod && key === 'z') { event.preventDefault(); travel(event.shiftKey ? redoHistory : undoHistory); }
        else if (mod && key === 'c' && members.length) { event.preventDefault(); setClipboard(copySelection(tl, selection)); }
        else if (mod && key === 'v' && clipboard) { event.preventDefault(); paste(); }
        else if (mod && key === 'a') { event.preventDefault(); setSelection(['video', 'audio', 'text'].flatMap(track => tl[track].map(c => ({ track, id: c.id })))); }
        else if (mod && key === 'd' && item) { event.preventDefault(); duplicate(); }
        else if ((key === 's' || (mod && key === 'b')) && item) { event.preventDefault(); apply(t => splitSequenceClip(t, selected.track, item.id, frame)); }
        else if (['delete', 'backspace'].includes(key) && item) { event.preventDefault(); remove(); }
        else if (key === ' ' && total && !event.target.closest('button, a')) { event.preventDefault(); void play(); }
        else if(key==='home'){event.preventDefault();seek(0);}
        else if(key==='end'){event.preventDefault();seek(Math.max(0,total-1));}
        else if(key==='escape'){event.preventDefault();setSelected(null);setSelection([]);}
        else if(key==='j'){event.preventDefault();seek(frame-30);}
        else if(key==='k'){event.preventDefault();pause();}
        else if(key==='l'&&total){event.preventDefault();void play();}
        else if(event.shiftKey&&key==='z'){event.preventDefault();fitTimeline();}
        else if(['+','='].includes(key)){event.preventDefault();setPpf(value=>stepTimelineZoom(value,1));}
        else if(key==='-'){event.preventDefault();setPpf(value=>stepTimelineZoom(value,-1));}
        else if(key==='?'){event.preventDefault();pause();setShortcuts(true);}
        else if (['arrowleft', 'arrowright'].includes(key)) { event.preventDefault(); seek(frame + (key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? 30 : 1)); }
    }
    const patch = next => apply(t => {
        if(next.error)return next;
        const current = t[selected.track].find(c => c.id === selected.id);
        if (next.transform && current.keyframes?.length && frame >= current.start && frame < current.start + current.len) {
            const at = frame - current.start, key = { frame: at, x: next.transform.x, y: next.transform.y, scale: next.transform.scale, rotation: next.transform.rotation, opacity: next.transform.opacity, easing: 'linear' };
            next = { ...next, keyframes: [...current.keyframes.filter(k => k.frame !== at), key].sort((a, b) => a.frame - b.frame) };
        }
        if(current.parameterKeyframes?.length && (next.filter || next.colourAdjustment) && frame>=current.start && frame<current.start+current.len) {
            const at=frame-current.start,key=parameterKeyframe({...current,...next,parameterKeyframes:[]},at);
            next={...next,parameterKeyframes:[...current.parameterKeyframes.filter(k=>k.frame!==at),key].sort((a,b)=>a.frame-b.frame)};
        }
        return updateSequenceClip(t, selected.track, selected.id, next);
    });
    const locked = item && trackFor(tl, item)?.locked, disabled = exporting || busy;
    return <div role="region" aria-label="Multitrack editing workspace" style={EDITOR_PALETTE} className={`${fitScreen?"outline-none lg:fixed lg:inset-0 lg:z-[60] lg:flex lg:flex-col lg:overflow-hidden":"space-y-3 rounded-2xl"} bg-vx-base text-vx-fg`} tabIndex={0} onKeyDown={keys}>
        {shortcuts&&<ShortcutGuide onClose={()=>setShortcuts(false)} />}
        <header aria-label="Editor header" className="flex min-h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-vx-border bg-vx-panel px-3 py-1.5">
            <div className="flex shrink-0 items-center gap-2.5 border-r border-vx-border pr-3" aria-label="Veyrnox.ai Cut">
                <Logo size={28} className="sm:hidden" />
                <Logo size={28} wordmark className="hidden sm:inline-flex" />
                <span aria-hidden="true" className="h-5 w-px bg-vx-border" />
                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-vx-fg-body">Cut</span>
            </div>
            <ProjectBar compact onContext={setProjectContext} tl={tl} blobs={blobs} onLoadTimeline={load} onRelinked={relinked} />
            <div className="ml-auto flex shrink-0 items-center gap-2">
                <ProjectFileControls compact tl={tl} onLoadTimeline={loadProjectFile} disabled={disabled} openDisabled={!!projectContext?.id} name={projectContext?.id ? 'veyrnox-cloud-project' : 'veyrnox-studio-project'} />
                <WorkspaceLayout compact layout={layout} onChange={setLayout} />
                <Button size="sm" variant="money" onClick={onCredits}>Credits</Button>
                <Button size="sm" variant="ghost" aria-pressed={fitScreen} onClick={()=>setFitScreen(v=>!v)}>{fitScreen?'Exit full editor':'Full editor'}</Button>
            </div>
        </header>
        <div aria-label="Edit commands" className="flex min-h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-vx-border bg-vx-panel px-3 py-1.5">
            <Button aria-label="Undo" title="Undo" className="px-2" size="sm" disabled={!history.past.length || disabled} onClick={() => travel(undoHistory)}><CommandIcon name="Undo" /></Button><Button aria-label="Redo" title="Redo" className="px-2" size="sm" disabled={!history.future.length || disabled} onClick={() => travel(redoHistory)}><CommandIcon name="Redo" /></Button>
            <Button aria-label="Duplicate" title="Duplicate" className="px-2" size="sm" disabled={!members.length || selectionLocked || disabled} onClick={duplicate}><CommandIcon name="Duplicate" /></Button><Button aria-label="Split" title="Split" className="px-2" size="sm" disabled={!item || locked || disabled} onClick={() => apply(t => splitSequenceClip(t, selected.track, item.id, frame))}><CommandIcon name="Split" /></Button><Button aria-label="Delete" title="Delete" className="px-2" size="sm" disabled={!members.length || selectionLocked || disabled} onClick={remove}><CommandIcon name="Delete" /></Button>
            <Button aria-label="Copy" title="Copy" className="px-2" size="sm" variant="ghost" disabled={!members.length || disabled} onClick={() => setClipboard(copySelection(tl, selection))}><CommandIcon name="Copy" /></Button><Button aria-label="Paste at playhead" title="Paste at playhead" className="px-2" size="sm" variant="ghost" disabled={!clipboard || disabled} onClick={paste}><CommandIcon name="Paste at playhead" /></Button>
            <Button aria-label="Group" title="Group" className="px-2" size="sm" variant="ghost" disabled={members.length < 2 || selectionLocked || disabled} onClick={() => apply(t => groupSelection(t, selection))}><CommandIcon name="Group" /></Button><Button aria-label="Ungroup" title="Ungroup" className="px-2" size="sm" variant="ghost" disabled={!members.some(c => c.groupId) || selectionLocked || disabled} onClick={() => apply(t => groupSelection(t, selection, false))}><CommandIcon name="Ungroup" /></Button>
            {['video', 'audio', 'text'].map(kind => <Button key={kind} aria-label={`Add ${kind} track`} title={`Add ${kind} track`} size="sm" variant="ghost" disabled={disabled} onClick={() => apply(t => addSequenceTrack(t, kind))}>{kind} +</Button>)}
            <label className="ml-1 flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Snap</label><label className="flex shrink-0 items-center text-xs">Ripple delete<select aria-label="Ripple delete mode" className="ml-2 rounded border border-vx-border bg-vx-base p-1" value={ripple} onChange={e=>setRipple(e.target.value)}><option value="none">Off</option><option value="lane">Selected tracks</option><option value="all">All tracks</option></select></label>
        </div>
        {notice && <p role="alert" className="mx-3 mt-2 rounded-lg border border-vx-border bg-vx-panel p-3 text-sm">{notice}</p>}
        <div className={`grid min-h-0 gap-px bg-vx-border lg:grid-cols-[var(--workspace-columns)] ${fitScreen?"lg:flex-1 lg:[container-type:size] lg:[--panel-max-height:100%]":""}`} style={{ '--workspace-columns':workspaceColumns(layout,binWidth) }}>
            <aside aria-label="Project media" hidden={layout.mediaDock==='hidden'} style={{order:layout.mediaDock==='right'?3:1,maxHeight:fitScreen?`var(--panel-max-height, ${layout.previewHeight+5}vh)`:`${layout.previewHeight+5}vh`}} className="flex flex-col gap-3 overflow-hidden bg-vx-panel p-2 md:flex-row">
                <EditorToolRail panel={panel} onPanel={setPanel} disabled={disabled} sharedTools={sharedTools}/><div className="min-w-0 flex-1 space-y-3 overflow-y-auto py-1 pr-1">
                {panel === 'Media' && <><AdvancedMediaBin tl={tl} blobs={blobs} loaded={loaded} disabled={disabled} apply={apply} onFiles={files} onIngest={ingest} onAdd={add} onRemove={id => apply(t => removeSequenceMedia(t, id))} onRelink={relink} onDetails={(id,patch)=>apply(t=>updateMediaDetails(t,id,patch))} proxies={proxies} onProxy={createProxy} onRemoveProxy={removeProxy} onError={setNotice} />
                {proxyJob && <div role="status" className="space-y-2 text-xs">Preparing preview proxy<progress aria-label="Preview proxy progress" max={1} value={proxyJob.progress} className="w-full" /><Button size="sm" onClick={()=>abort.current?.abort()}>Cancel preview proxy</Button></div>}
                <label className="block text-xs">Panel width<input aria-label="Media panel width" type="range" min={180} max={360} value={binWidth} onChange={e => setBinWidth(Number(e.target.value))} className="w-full accent-vx-accent" /></label>
                <Button size="sm" disabled={disabled} onClick={() => { const next = apply(t => addSequenceText(t, { start: Math.min(frame, SEQUENCE_MAX - 90) })); if (next) selectClip({ track: 'text', id: `t${next.seq}` }); }}>Add text</Button></>}
                {panel==='Audio' && <OriginalAudioPanel disabled={disabled} onIngest={ingest} />}
                {panel==='Plugins' && <AssetPackPanel disabled={disabled} onIngest={ingest} />}
                <div hidden={panel !== 'Generate'}><GenerationPanel disabled={disabled} onIngest={ingest} /></div>
                <div hidden={panel!=='Audio'}><GenerationPanel voiceover disabled={disabled} onIngest={ingest} /></div>
                <div hidden={panel!=='Elements'}><GenerationPanel avatar disabled={disabled} onIngest={ingest} /></div>
                {panel === 'Text' && <><TextStyleCatalog disabled={disabled} frame={frame} apply={apply} onSelect={selectClip} />{organization&&<CustomFontPanel tl={tl} registry={fontRegistry} disabled={disabled} apply={apply} onError={setNotice} onLoaded={()=>setTick(n=>n+1)} onBusy={setBusy} />}</>}
                {panel === 'Filters' && <FilterPanel tl={tl} selected={selected} selection={selection} disabled={disabled} apply={apply} />}
                {panel === 'Animation' && <AnimationCatalogPanel tl={tl} selected={selected} disabled={disabled} apply={apply} />}
                {['Templates', 'Elements', 'Effects', 'Transitions'].includes(panel) && <CatalogPanel key={panel} panel={panel} tl={tl} selected={selected} frame={frame} disabled={disabled} apply={apply} onSelect={selectClip} selectedBlob={selectedBlob} localInference={localInference} onIngest={ingest} onBusy={setBusy} onError={setNotice} />}
                {panel==='Brand kit' && sharedTools && <BrandKitPanel onIngest={ingest} project={projectContext} item={selected?.track==='text'?item:null} frame={frame} disabled={disabled} apply={apply} onSelect={selectClip} />}
                {panel==='Review' && sharedTools && <ReviewPanel key={projectContext?.id} project={projectContext} frame={frame} disabled={disabled} onSeek={seek} />}
                {panel === 'Captions' && <CaptionPanel tl={tl} blobs={blobs} disabled={disabled} frame={frame} apply={apply} onSelect={selectClip} onSeek={seek} onError={setNotice} onBusy={setBusy} />}
                {panel === 'Transcript' && <TranscriptPanel tl={tl} blobs={blobs} disabled={disabled} frame={frame} apply={apply} onSelect={selectClip} onSeek={seek} onError={setNotice} onBusy={setBusy} />}
                </div>
            </aside>
            <section aria-label="Preview" style={{order:2}} className="flex min-h-0 flex-col gap-3 overflow-hidden bg-vx-panel p-3">
                <div className="relative mx-auto" style={{ width: `min(100%, calc(${fitScreen?`min(${layout.previewHeight}vh, max(48px, calc(100cqh - 68px)))`:`${layout.previewHeight}vh`} * ${size.width / size.height}))` }}><canvas ref={canvas} width={size.width} height={size.height} role="img" aria-label="Video preview" style={{maxHeight:fitScreen?`min(${layout.previewHeight}vh, max(48px, calc(100cqh - 68px)))`:`${layout.previewHeight}vh`}} className="w-full rounded-lg bg-black object-contain" /><CanvasHandles item={item && selected.track !== 'audio' && frame >= item.start && frame < item.start + item.len ? item : null} kind={selected?.track} frame={frame} disabled={disabled || locked} onChange={patch} /></div>
                {previewStatus.sources.some(s=>s.proxy) && <p role="status" aria-label="Preview source quality" className="text-xs text-vx-fg-muted">Proxy preview · {previewStatus.sources.filter(s=>s.proxy).map(s=>`${s.width} × ${s.height}`).join(', ')} · export uses the original sources</p>}
                <EditorTransport frame={frame} total={total} playing={playing} preparing={preparing} disabled={disabled} onPlay={play} onPause={pause} onSeek={seek} onFit={fitTimeline} onShortcuts={()=>{pause();setShortcuts(true);}} />
            </section>
            <aside aria-label="Inspector" hidden={!layout.inspector} style={{order:layout.mediaDock==='right'?1:3,maxHeight:fitScreen?`var(--panel-max-height, ${layout.previewHeight+5}vh)`:`${layout.previewHeight+5}vh`}} className="space-y-3 overflow-y-auto bg-vx-panel p-3">
                <fieldset disabled={disabled || locked} className="space-y-3">
                    <h2 className="text-sm font-bold">{item ? selected.track === 'text' ? 'Text' : tl.media[item.mediaId]?.name : 'Select a clip'}</h2>
                    {item && <><label className="block text-xs">Track<select aria-label="Clip track" className={field} value={item.trackId} onChange={e => apply(t => moveSequence(t, selected.track, item.id, item.start, e.target.value, false))}>{tl.tracks.filter(t => t.kind === selected.track).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                    <NumberControl label="Clip start seconds" value={item.start / 30} min={0} max={600} step={1 / 30} onChange={n => apply(t => moveSelection(t, selection, selected, n * 30, item.trackId, false, frame))} />
                    <NumberControl label="Clip duration seconds" value={item.len / 30} min={1 / 30} max={600} step={1 / 30} onChange={n => apply(t => trimSequence(t, selected.track, item.id, 'out', Math.round(n * 30) - item.len))} />
                    {selected.track === 'text' ? <><label className="block text-xs">Words<textarea aria-label="Words" key={`${item.id}:${item.text}`} className={field} rows={3} maxLength={1000} defaultValue={item.text} onBlur={e => { if (e.target.value.trim() && e.target.value !== item.text) patch({ text: e.target.value }); }} /></label><TextControls item={item} frame={frame} onChange={patch} fonts={tl.fonts} /></> : <>
                        {selected.track === 'video' && <><VisualControls item={item} frame={frame} onChange={patch} /><SmartPictureControls item={item} onChange={patch} /><BackgroundControls item={item} media={tl.media} onChange={patch} onAll={background=>apply(t=>t.video.some(c=>trackFor(t,c)?.locked)?{error:'Unlock every video track before applying all backgrounds.'}:{...t,video:t.video.map(c=>({...c,background}))})} /></>}
                        {!['image','graphic'].includes(tl.media[item.mediaId]?.kind) && <details><summary className="cursor-pointer text-xs font-bold">Speed curve and reverse</summary><SpeedControls key={`${item.id}:${item.len}:${item.rate}:${JSON.stringify(item.speedCurve)}`} item={item} frame={frame} onCurve={points=>apply(t=>setSequenceSpeedCurve(t,selected.track,item.id,points))} onReverse={()=>apply(t=>reverseSequenceClip(t,selected.track,item.id))} onFreeze={selected.track==='video'?()=>apply(t=>insertSequenceFreeze(t,item.id,frame)):null} onRate={n=>apply(t=>setSequenceRate(t,selected.track,item.id,n))} /></details>}
                        <AudioProcessingControls item={item} media={tl.media[item.mediaId]} onChange={patch} onAll={settings=>apply(t=>{
                            const affected=c=>t.media[c.mediaId].hasAudio && c.freezeFrame===undefined;
                            if([...t.video,...t.audio].some(c=>affected(c)&&trackFor(t,c)?.locked))return {error:'Unlock all affected sound tracks first.'};
                            const voice=c=>affected(c)?{...c,audioProcessing:{...AUDIO_DEFAULTS,...c.audioProcessing,voice:settings.voice,pitch:settings.pitch,gateDb:settings.gateDb}}:c;
                            return {...t,video:t.video.map(voice),audio:t.audio.map(voice)};
                        })} /><AudioEffectsControls item={item} media={tl.media[item.mediaId]} onChange={patch} /><SoundControls item={item} onChange={patch} onRate={item.freezeFrame===undefined && !['image', 'graphic'].includes(tl.media[item.mediaId]?.kind) ? n => apply(t => setSequenceRate(t, selected.track, item.id, n)) : null} onExtract={item.freezeFrame===undefined && selected.track === 'video' && tl.media[item.mediaId]?.hasAudio ? () => apply(t => extractSequenceAudio(t, item.id)) : null} />
                        {selected.track === 'video' && <NumberControl label="Dissolve duration (seconds)" value={item.transition / 30} min={0} max={2} onChange={n => patch({ transition: Math.round(n * 30) })} />}
                    </>}</>}

                </fieldset>
                {selected?.track==='video' && tl.media[item?.mediaId]?.kind==='video' && <><MotionProcessingControls key={`motion:${item.id}`} media={tl.media[item.mediaId]} blob={selectedBlob} timeline={tl} disabled={disabled || locked} onIngest={ingest} onBusy={setBusy} onError={setNotice} />{localInference&&panel!=='Effects'&&<PersonProcessingControls key={`person:${item.id}`} media={tl.media[item.mediaId]} blob={selectedBlob} timeline={tl} disabled={disabled || locked} onIngest={ingest} onBusy={setBusy} onError={setNotice} />}</>}
                <label className="flex items-center justify-between text-xs">Canvas background<input aria-label="Canvas background" type="color" disabled={disabled} value={tl.background} onChange={e => apply(t => ({ ...t, background: e.target.value }))} /></label>
                <label className="block text-xs">Shape<select aria-label="Shape" className={field} disabled={disabled} value={tl.aspect} onChange={e => apply(t => ({ ...t, aspect: e.target.value }))}>{['source', '16:9', '9:16', '1:1'].map(a => <option key={a}>{a}</option>)}</select></label>
                <ExportPanel tl={tl} name={exportName} onName={setExportName} height={height} onHeight={setHeight} disabled={disabled} exporting={exporting} progress={progress} result={result} blocker={blocker} onExport={runExport} onCancel={() => abort.current?.abort()} onCover={async () => { await preview.current.draw(tl, frame, canvas.current); return new Promise((resolve, reject) => canvas.current.toBlob(blob => blob ? resolve(blob) : reject(new Error('No frame')), 'image/png')); }} />
            </aside>
        </div>
        <div className="flex min-h-10 shrink-0 items-center gap-3 border-y border-vx-border bg-vx-panel px-3"><h2 className="text-xs font-extrabold uppercase tracking-wider text-vx-fg-muted">Timeline</h2><label className="flex min-w-0 flex-1 items-center gap-2 text-xs"><span className="sr-only">Timeline zoom</span><button type="button" aria-label="Zoom out timeline" disabled={ppf<=.25} onClick={()=>setPpf(value=>stepTimelineZoom(value,-1))} className="grid size-7 shrink-0 place-items-center rounded border border-vx-border hover:border-vx-accent disabled:opacity-35">−</button><input aria-label="Timeline zoom" aria-valuetext={`${ppf} pixels per frame`} type="range" min={0.25} max={8} step={0.25} value={ppf} onChange={e => setPpf(Number(e.target.value))} className="w-full max-w-48 accent-vx-accent" /><button type="button" aria-label="Zoom in timeline" disabled={ppf>=8} onClick={()=>setPpf(value=>stepTimelineZoom(value,1))} className="grid size-7 shrink-0 place-items-center rounded border border-vx-border hover:border-vx-accent disabled:opacity-35">+</button></label><span className="font-vx-mono text-[10px] text-vx-fg-muted">{ppf.toFixed(2)} px/frame</span></div>
        <TrackTimeline height={fitScreen?`min(${layout.timelineHeight}px, 45svh)`:layout.timelineHeight} onMediaDrop={(kind,id,start,lane)=>apply(t=>addSequenceClip(t,kind,id,{start,trackId:lane}))} blobs={blobs} loaded={loaded} tl={tl} frame={frame} selected={selected} selection={selection} ppf={ppf} disabled={disabled} snap={snap} follow={playing} onViewport={setTimelineViewport} onZoom={direction=>setPpf(value=>stepTimelineZoom(value,direction))} onSelect={selectClip} onSeek={seek} onTrim={(kind, id, edge, delta) => apply(t => trimSequence(t, kind, id, edge, delta))} onMove={(kind, id, at, lane, snap) => apply(t => moveSelection(t, selection, { track: kind, id }, at, lane, snap, frame))} onReorder={(id, direction) => apply(t => reorderSequenceTrack(t, id, direction))} onRemove={id => apply(t => removeSequenceTrack(t, id))} onTrack={(id, patch) => apply(t => updateSequenceTrack(t, id, patch))} />
        <p className={`text-xs text-vx-fg-muted ${fitScreen?"lg:hidden":""}`}>Editing and export run in this browser. Imported files remain on this computer. Up to 10 minutes, 16 tracks and 40 video clips. Video tracks later in the track list draw over earlier ones. Shift-click clips to select several; groups move together.</p>
    </div>;
}
