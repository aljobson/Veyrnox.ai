'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMultitrackEnabled } from './MultitrackFlag';
import { getStoredUserId,onSessionChange } from '../../../lib/authClient';
import { emptySequence } from '../../_lib/editorSequence.mjs';
import { emptyTimeline } from '../../_lib/editorTimeline.mjs';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { gatewayFetch, makeIdempotencyKey } from '../../_lib/gateway';
import { useProjectsEnabled } from '../ProjectsFlag';
import { equalProjectDocuments } from '../../../../lib/projectDocument.js';
import { conflictCopyName, documentForTimeline, matchLocalFile, mediaToRelink, projectDocumentDifferences, remoteSaveLabel, saveProblem, timelineFromDocument } from '../../_lib/editorProject.mjs';
import { loadProjectAssetBlob } from '../../_lib/editorProjectAssets.mjs';
import { loadEditorLibraryItem } from '../../_lib/editorLibraryCollection.mjs';
import { probeMedia, checkProbe, checkLocalFile } from '../../_lib/editorMedia.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const field = 'rounded-xl border border-vx-border bg-vx-base px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent';
const date = v => (v ? new Date(v).toLocaleString() : '');

/**
 * Slice 3 (ADR-0080): the timeline lives in a project document (v2). `onLoadTimeline(tl)` replaces the page's timeline; `blobs` is
 * the page's file map, filled here when a reopened project's files are fetched (Library) or chosen again (local). Shown only behind
 * TENANT_PROJECTS_ENABLED; the API itself answers 404 wherever the flag is off.
 */
export function ProjectBar(props) {
    const [actor,setActor]=useState(getStoredUserId),context=useRef(null),account=useRef(actor);
    const {onContext,onLoadTimeline,onRelinked,blobs,tl}=props;
    const projectContext=useCallback(value=>{context.current=value;onContext?.(value);},[onContext]);
    useEffect(()=>onSessionChange(session=>{
        const next=session?.user?.id || null;if(next===account.current)return;account.current=next;
        if(context.current?.id){blobs.current.clear();onLoadTimeline(tl.schemaVersion===3?emptySequence():emptyTimeline());onRelinked();}
        context.current=null;onContext?.(null);setActor(next);
    }),[blobs,onLoadTimeline,onRelinked,onContext,tl.schemaVersion]);
    return <ProjectSessionBar key={actor || 'signed-out'} {...props} onContext={projectContext} />;
}
function ProjectSessionBar({ tl, blobs, onLoadTimeline, onRelinked, onContext,compact=false }) {
    const enabled = useProjectsEnabled();
    const multitrack = useMultitrackEnabled();
    const actor=useRef(getStoredUserId()).current;
    const alive = useRef(true), pending = useRef(null), copyPending = useRef(null), timer = useRef(null);
    const currentAccount=useCallback(()=>alive.current && actor===getStoredUserId(),[actor]);
    const [workspaceId,setWorkspaceId]=useState(null);
    const [projectId, setProjectId] = useState(null), [name, setName] = useState('');
    const [doc, setDoc] = useState(null), [revision, setRevision] = useState(0), [savedAt, setSavedAt] = useState(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [remote, setRemote] = useState(null);
    const [relink, setRelink] = useState({ library: [], local: [] }), [relinking, setRelinking] = useState(false);
    const [picker, setPicker] = useState(null), [versions, setVersions] = useState(null), [preview, setPreview] = useState(null);
    const endpoint = projectId ? `/projects/${encodeURIComponent(projectId)}` : null;
    useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);

    // Which files a reopened timeline still needs. Library ones are fetched here; local ones are asked for.
    const refreshRelink = useCallback(timeline => {
        const need = mediaToRelink(timeline, new Set(blobs.current.keys()));
        setRelink(need);
        return need;
    }, [blobs]);
    // Fetch Library files again. The missing list is recomputed when this finishes, so a file that arrived is not still shown as missing.
    const fetchLibrary = useCallback(async (items, timeline) => {
        setRelinking(true);
        for (const item of items) {
            try { const { blob } = await (item.assetId?loadProjectAssetBlob(gatewayFetch,{projectId:item.projectId,assetId:item.assetId}):loadEditorLibraryItem(gatewayFetch,item,{actor:getStoredUserId() || 'guest',isCurrent:currentAccount})); if(!currentAccount())return;blobs.current.set(item.id, blob); }
            catch { /* stays listed as missing */ }
        }
        if (currentAccount()) { setRelinking(false); refreshRelink(timeline); onRelinked(); }
    }, [blobs, onRelinked, refreshRelink,currentAccount]);
    const open = useCallback(async id => {
        setBusy(true); setError('');
        try {
            const [p, d] = await Promise.all([gatewayFetch(`/projects/${encodeURIComponent(id)}`), gatewayFetch(`/projects/${encodeURIComponent(id)}/document`)]);
            if (!currentAccount()) return;
            if (d.document.schema_version === 3 && !multitrack) { setError('This project needs the multitrack editor. Its saved work has been kept.'); return; }
            const { timeline, problem } = timelineFromDocument(d.document);
            setWorkspaceId(p.project?.workspace_id || null);setProjectId(id); setName(p.project?.name || 'Project'); setDoc(d.document); setRevision(d.revision); setSavedAt(d.created_at);
            onLoadTimeline(timeline);
            if (problem) setError(`The saved timeline could not be opened (${problem}). Starting empty.`);
            const need = refreshRelink(timeline);
            if (need.library.length || need.assets.length) fetchLibrary([...need.library,...need.assets], timeline);
        } catch (e) { if (currentAccount()) setError(e.status === 404 ? 'This project is not available here.' : 'Could not open the project.'); }
        finally { if (currentAccount()) setBusy(false); }
    }, [onLoadTimeline, refreshRelink, fetchLibrary, multitrack,currentAccount]);
    useEffect(() => {
        const id = new URLSearchParams(window.location.search).get('project');
        if (enabled && id && UUID.test(id)) open(id.toLowerCase());
    }, [enabled, open]);
    useEffect(() => { if (projectId) refreshRelink(tl); }, [tl, projectId, refreshRelink]);

    const current = doc ? documentForTimeline(doc, tl) : null;
    const dirty = !!doc && !equalProjectDocuments(doc, current);
    useEffect(()=>{onContext?.({id:projectId,workspaceId,revision,dirty,busy,error:!!error,savedAt});},[onContext,projectId,workspaceId,revision,dirty,busy,error,savedAt]);
    const save = useCallback(async ({ against = revision, restore = null } = {}) => {
        if (!currentAccount() || !endpoint || !doc) return;
        const snapshot = restore ? null : documentForTimeline(doc, tl);
        if (snapshot && new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 32768) { setError('This project exceeds the save limit. Shorten its brief or use fewer clips and caption lines.'); return; }
        if (!pending.current || pending.current.restore !== restore || (!restore && !equalProjectDocuments(pending.current.snapshot, snapshot))) pending.current = { key: makeIdempotencyKey(), snapshot, restore };
        setBusy(true); setError('');
        try {
            const body = JSON.stringify({ expected_revision: against, ...(restore ? { restore_revision: restore } : { document: snapshot }) });
            const r = await gatewayFetch(`${endpoint}/document`, { method: 'PUT', body, headers: { 'idempotency-key': pending.current.key }, signal: AbortSignal.timeout(15000) });
            if (!currentAccount()) return;
            setDoc(r.document); setRevision(r.revision); setSavedAt(r.created_at); setRemote(null); pending.current = null;
            if (restore) { const { timeline } = timelineFromDocument(r.document); onLoadTimeline(timeline); const need = refreshRelink(timeline); if (need.library.length || need.assets.length) fetchLibrary([...need.library,...need.assets], timeline); setPreview(null); setVersions(null); }
        } catch (e) {
            if (!currentAccount()) return;
            setError(saveProblem(e));
            if (e.status === 409) { try { const latest=await gatewayFetch(`${endpoint}/document`);if(currentAccount())setRemote(latest); } catch { /* the message already says to retry */ } }
        } finally { if (currentAccount()) setBusy(false); }
    }, [endpoint, doc, tl, revision, onLoadTimeline, refreshRelink, fetchLibrary,currentAccount]);
    // Autosave three seconds after the last edit, like the project page's draft, but only when nothing is in the way.
    useEffect(() => {
        clearTimeout(timer.current);
        if (dirty && !busy && !remote && !error) timer.current = setTimeout(() => save(), 3000);
        return () => clearTimeout(timer.current);
    }, [dirty, busy, remote, error, save]);
    // Saved versions are immutable. Polling the head lets another device or collaborator surface before this tab overwrites it.
    useEffect(() => {
        if (!endpoint || busy || remote) return;
        let cancelled = false;
        const check = async () => {
            if (document.visibilityState === 'hidden') return;
            try {
                const latest = await gatewayFetch(`${endpoint}/document`);
                if (!cancelled && currentAccount() && latest.revision > revision) setRemote(latest);
            } catch { /* background sync never replaces the active save status */ }
        };
        const interval = window.setInterval(check, 15000);
        window.addEventListener('focus', check);
        return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener('focus', check); };
    }, [endpoint, revision, busy, remote, currentAccount]);

    async function chooseAgain(event) {
        const file = event.target.files[0]; event.target.value = '';
        if (!file) return;
        const ok = checkLocalFile(file);
        if (ok.error) { setError(ok.error); return; }
        const probe = await probeMedia(file);
        if(!currentAccount())return;const bad = checkProbe(probe);
        if (bad) { setError(bad); return; }
        const match = matchLocalFile(tl, file, probe, new Set(blobs.current.keys()));
        if (!match) { setError(`That is not one of the files this project needs (same name and length).`); return; }
        blobs.current.set(match.id, file); setError(''); refreshRelink(tl); onRelinked();
    }
    async function openPicker() {
        setPicker({ projects: null, workspace: null, newName: '' });
        try {
            const w = await gatewayFetch('/workspaces');
            if(!currentAccount())return;const workspace = w.workspaces?.[0]?.id || null;
            const rows = workspace ? await gatewayFetch(`/projects?workspace_id=${encodeURIComponent(workspace)}`) : { projects: [] };
            if (currentAccount()) setPicker({ projects: rows.projects || [], workspace, newName: '' });
        } catch (e) { if (currentAccount()) setPicker({ projects: [], workspace: null, newName: '', problem: e.status === 404 ? 'Projects are not switched on here.' : 'Could not load your projects.' }); }
    }
    async function attach(id, created = null) {
        if(!currentAccount())return;
        setPicker(null);
        // Open the project but keep the timeline being edited: save it as the first version of the editor's work there.
        setBusy(true); setError('');
        try {
            const [d,p]=await Promise.all([gatewayFetch(`/projects/${encodeURIComponent(id)}/document`),gatewayFetch(`/projects/${encodeURIComponent(id)}`)]);
            if (!currentAccount()) return;
            if (d.document.schema_version === 3 && !multitrack) { setError('This project needs the multitrack editor. Its saved work has been kept.'); return; }
            window.history.replaceState(null, '', `${window.location.pathname}?project=${encodeURIComponent(id)}`);
            setWorkspaceId(p.project?.workspace_id || null);setProjectId(id); setName(created || 'Project'); setDoc(d.document); setRevision(d.revision); setSavedAt(d.created_at);
        } catch { if (currentAccount()) setError('Could not open the project.'); }
        finally { if (currentAccount()) setBusy(false); }
    }
    async function createProject() {
        if(!currentAccount())return;
        const n = picker.newName.trim();
        if (!n || !picker.workspace) return;
        try {
            const r = await gatewayFetch('/projects', { method: 'POST', body: JSON.stringify({ workspace_id: picker.workspace, name: n }), headers: { 'idempotency-key': makeIdempotencyKey() } });
            if(currentAccount())await attach(r.project.id, r.project.name);
        } catch (e) { if (currentAccount()) setPicker(p => ({ ...p, problem: e.status === 429 ? 'Too many projects for now.' : 'Could not create the project.' })); }
    }
    async function openVersions() {
        setVersions([]);
        try { const r = await gatewayFetch(`${endpoint}/history`); if (currentAccount()) setVersions(r.versions || []); } catch { if (currentAccount()) setVersions(null); }
    }
    async function viewVersion(n) {
        try { const r = await gatewayFetch(`${endpoint}/document?revision=${n}`); if (currentAccount()) setPreview(r); } catch { if (currentAccount()) setError('Could not load that version.'); }
    }
    function loadRemote() {
        const { timeline } = timelineFromDocument(remote.document);
        setDoc(remote.document); setRevision(remote.revision); setSavedAt(remote.created_at); setRemote(null); setError(''); pending.current = null;
        onLoadTimeline(timeline); const need = refreshRelink(timeline); if (need.library.length || need.assets.length) fetchLibrary([...need.library,...need.assets], timeline);
    }
    async function keepLocalCopy() {
        if (!workspaceId || !doc || !remote || !currentAccount()) return;
        const localTimeline = tl, copy = copyPending.current ||= { createKey: makeIdempotencyKey(), saveKey: makeIdempotencyKey(), name: conflictCopyName(name), projectId: null };
        setBusy(true); setError('');
        try {
            if (!copy.projectId) {
                const created = await gatewayFetch('/projects', { method: 'POST', body: JSON.stringify({ workspace_id: workspaceId, name: copy.name }), headers: { 'idempotency-key': copy.createKey } });
                copy.projectId = created.project.id; copy.name = created.project.name;
            }
            const copyDocument = documentForTimeline({ ...doc, project_id: copy.projectId }, localTimeline);
            const saved = await gatewayFetch(`/projects/${encodeURIComponent(copy.projectId)}/document`, { method: 'PUT', body: JSON.stringify({ expected_revision: 0, document: copyDocument }), headers: { 'idempotency-key': copy.saveKey }, signal: AbortSignal.timeout(15000) });
            if (!currentAccount()) return;
            window.history.replaceState(null, '', `${window.location.pathname}?project=${encodeURIComponent(copy.projectId)}`);
            setProjectId(copy.projectId); setName(copy.name); setDoc(saved.document); setRevision(saved.revision); setSavedAt(saved.created_at); setRemote(null); pending.current = null; copyPending.current = null;
        } catch (e) { if (currentAccount()) setError(e.status === 429 ? 'Too many project saves for now. Try this copy again in a minute.' : 'Could not save the copy. Your edit is still open; try again.'); }
        finally { if (currentAccount()) setBusy(false); }
    }

    if (!enabled) return null;
    const status = busy ? 'Saving…' : error ? 'Not saved' : dirty ? 'Unsaved changes' : savedAt ? `Saved · version ${revision}` : 'Not saved yet';
    return <section aria-label="Project" className={compact?'min-w-0 flex-1 space-y-2':'space-y-3 rounded-2xl border border-vx-border bg-vx-panel p-4'}>
        <div className={`flex items-center ${compact?'min-w-0 gap-2':'flex-wrap gap-3'}`}>
            {projectId ? <>
                <span className="min-w-0 max-w-48 flex-1 truncate text-sm font-bold" title={name}>{name}</span>
                <span role="status" className="hidden text-xs text-vx-fg-muted sm:inline">{status}</span>
                <Button className="shrink-0 px-3" size="sm" disabled={busy || !dirty} onClick={() => save()}>Save</Button>
                <Button className="hidden shrink-0 px-3 sm:inline-flex" size="sm" variant="ghost" disabled={busy} onClick={openVersions}>Versions</Button>
            </> : <Button className="max-w-full px-3" size="sm" variant="ghost" disabled={busy} onClick={openPicker}><span className="sm:hidden">Save project</span><span className="hidden sm:inline">Save to a project</span></Button>}
            {relinking && <span role="status" className="text-xs text-vx-fg-muted">Fetching the project files…</span>}
        </div>
        {error && <p role="alert" className="text-sm">{error}</p>}
        {remote && <div className="rounded-xl border border-vx-accent p-3 text-sm" role="alert"><p className="font-bold">{remoteSaveLabel(remote.actor_id,actor)} saved version {remote.revision}.</p><p className="mt-1 text-xs text-vx-fg-muted">Your open edit is still here. Keep it as a separate project or discard it and load the latest saved version.</p>{projectDocumentDifferences(current,remote.document).length>0 && <ul className="mt-2 list-disc pl-5 text-xs">{projectDocumentDifferences(current,remote.document).map(change=><li key={change}>{change}</li>)}</ul>}{remote.document.schema_version === 3 && !multitrack && <p>Open this project in the multitrack editor to load the newer version.</p>}
            <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={keepLocalCopy}>Keep my edit as a copy</Button>
                <Button size="sm" variant="ghost" disabled={busy || (remote.document.schema_version === 3 && !multitrack)} onClick={loadRemote}>Discard mine and load latest</Button>
            </div></div>}
        {relink.local.length > 0 && <div className="rounded-xl border border-vx-border p-3 text-sm">
            <p>This project needs files from your computer again (they were never uploaded):</p>
            <ul className="mt-1 list-disc pl-5">{relink.local.map(m => <li key={m.id}>{m.name}</li>)}</ul>
            <label className="mt-2 inline-flex cursor-pointer rounded-full border border-vx-border px-4 py-2 text-xs font-bold">Choose a file<input className="sr-only" type="file" accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,image/png,image/jpeg,image/webp" onChange={chooseAgain} /></label>
        </div>}
        {(relink.library.length > 0 || relink.assets?.length > 0) && !relinking && <p className="text-xs text-vx-fg-muted">{relink.library.length+(relink.assets?.length || 0)} saved source file(s) could not be fetched. <button type="button" className="underline" onClick={() => fetchLibrary([...relink.library,...(relink.assets || [])], tl)}>Try again</button></p>}
        {picker && <Modal aria-label="Save to a project" onCancel={() => setPicker(null)} className="items-center justify-center p-4"><div className="w-full max-w-md rounded-2xl border border-vx-border bg-vx-base p-6">
            <h2 className="text-lg font-black">Save to a project</h2>
            {picker.problem && <p role="alert" className="mt-2 text-sm">{picker.problem}</p>}
            {picker.projects === null ? <p className="mt-3 text-sm text-vx-fg-muted">Loading…</p> : <ul className="mt-3 max-h-60 space-y-2 overflow-auto">
                {picker.projects.map(p => <li key={p.id}><button type="button" className={`${field} w-full text-left`} onClick={() => attach(p.id, p.name)}>{p.name}</button></li>)}
            </ul>}
            {picker.workspace && <div className="mt-4 flex gap-2"><input className={`${field} flex-1`} placeholder="New project name" maxLength={80} value={picker.newName} onChange={e => setPicker(p => ({ ...p, newName: e.target.value }))} /><Button size="sm" disabled={!picker.newName.trim()} onClick={createProject}>Create</Button></div>}
            <div className="mt-4 flex justify-end"><Button size="sm" variant="ghost" onClick={() => setPicker(null)}>Cancel</Button></div>
        </div></Modal>}
        {versions && <Modal aria-label="Versions" onCancel={() => { setVersions(null); setPreview(null); }} className="items-center justify-center p-4"><div className="w-full max-w-md rounded-2xl border border-vx-border bg-vx-base p-6">
            <h2 className="text-lg font-black">Versions</h2>
            {versions.length === 0 ? <p className="mt-3 text-sm text-vx-fg-muted">No versions yet.</p> : <ol className="mt-3 max-h-60 space-y-2 overflow-auto">
                {versions.map(v => <li key={v.revision}><button type="button" className={`${field} w-full text-left`} onClick={() => viewVersion(v.revision)}>Version {v.revision}{v.revision === revision ? ' · Current' : ''}<span className="block text-xs text-vx-fg-muted">{v.actor_id===actor?'You':'Collaborator'} · {date(v.created_at)}{v.restored_from ? ` · restored from ${v.restored_from}` : ''}</span></button></li>)}
            </ol>}
            {preview && <div className="mt-4 rounded-xl border border-vx-border p-3 text-sm"><p className="font-bold">Version {preview.revision}</p><p className="text-xs text-vx-fg-muted">{date(preview.created_at)} · {[2, 3].includes(preview.document.schema_version) && preview.document.timeline ? `${preview.document.timeline.video.length} video clips, ${preview.document.timeline.audio.length} sounds, ${preview.document.timeline.text.length} texts` : 'no timeline'}</p>
                <p className="mt-2 text-xs text-vx-fg-muted">{dirty ? 'Save your current work before restoring.' : 'Restoring makes a new version; history is kept.'}</p>
                <Button size="sm" className="mt-2" disabled={busy || dirty || preview.revision === revision || (preview.document.schema_version === 3 && !multitrack)} onClick={() => save({ restore: preview.revision })}>Restore as new version</Button></div>}
            <div className="mt-4 flex justify-end"><Button size="sm" variant="ghost" onClick={() => { setVersions(null); setPreview(null); }}>Close</Button></div>
        </div></Modal>}
    </section>;
}
