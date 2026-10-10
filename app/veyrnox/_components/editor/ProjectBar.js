'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { gatewayFetch, makeIdempotencyKey } from '../../_lib/gateway';
import { useProjectsPreview } from '../../_lib/useProjectsPreview';
import { equalProjectDocuments } from '../../../../lib/projectDocument.js';
import { timelineFromDocument, documentForTimeline, mediaToRelink, matchLocalFile, saveProblem } from '../../_lib/editorProject.mjs';
import { loadLibraryBlob } from '../../_lib/editorLibrary.mjs';
import { probeMedia, checkProbe, checkLocalFile } from '../../_lib/editorMedia.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const field = 'rounded-xl border border-vx-border bg-vx-base px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent';
const date = v => (v ? new Date(v).toLocaleString() : '');

/**
 * Slice 3 (ADR-0080): the timeline lives in a project document (v2). `onLoadTimeline(tl)` replaces the page's timeline; `blobs` is
 * the page's file map, filled here when a reopened project's files are fetched (Library) or chosen again (local). Shown only behind
 * the projects preview switch; the API itself answers 404 wherever TENANT_PROJECTS_ENABLED is off.
 */
export function ProjectBar({ tl, blobs, onLoadTimeline, onRelinked }) {
    const enabled = useProjectsPreview();
    const alive = useRef(true), pending = useRef(null), timer = useRef(null);
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
            try { const { blob } = await loadLibraryBlob(gatewayFetch, item.jobId); blobs.current.set(item.id, blob); }
            catch { /* stays listed as missing */ }
        }
        if (alive.current) { setRelinking(false); refreshRelink(timeline); onRelinked(); }
    }, [blobs, onRelinked, refreshRelink]);
    const open = useCallback(async id => {
        setBusy(true); setError('');
        try {
            const [p, d] = await Promise.all([gatewayFetch(`/projects/${encodeURIComponent(id)}`), gatewayFetch(`/projects/${encodeURIComponent(id)}/document`)]);
            if (!alive.current) return;
            const { timeline, problem } = timelineFromDocument(d.document);
            setProjectId(id); setName(p.project?.name || 'Project'); setDoc(d.document); setRevision(d.revision); setSavedAt(d.created_at);
            onLoadTimeline(timeline);
            if (problem) setError(`The saved timeline could not be opened (${problem}). Starting empty.`);
            const need = refreshRelink(timeline);
            if (need.library.length) fetchLibrary(need.library, timeline);
        } catch (e) { if (alive.current) setError(e.status === 404 ? 'This project is not available here.' : 'Could not open the project.'); }
        finally { if (alive.current) setBusy(false); }
    }, [onLoadTimeline, refreshRelink, fetchLibrary]);
    useEffect(() => {
        const id = new URLSearchParams(window.location.search).get('project');
        if (enabled && id && UUID.test(id)) open(id.toLowerCase());
    }, [enabled, open]);
    useEffect(() => { if (projectId) refreshRelink(tl); }, [tl, projectId, refreshRelink]);

    const current = doc ? documentForTimeline(doc, tl) : null;
    const dirty = !!doc && !equalProjectDocuments(doc, current);
    const save = useCallback(async ({ against = revision, restore = null } = {}) => {
        if (!endpoint || !doc) return;
        const snapshot = restore ? null : documentForTimeline(doc, tl);
        if (!pending.current || pending.current.restore !== restore || (!restore && !equalProjectDocuments(pending.current.snapshot, snapshot))) pending.current = { key: makeIdempotencyKey(), snapshot, restore };
        setBusy(true); setError('');
        try {
            const body = JSON.stringify({ expected_revision: against, ...(restore ? { restore_revision: restore } : { document: snapshot }) });
            const r = await gatewayFetch(`${endpoint}/document`, { method: 'PUT', body, headers: { 'idempotency-key': pending.current.key }, signal: AbortSignal.timeout(15000) });
            if (!alive.current) return;
            setDoc(r.document); setRevision(r.revision); setSavedAt(r.created_at); setRemote(null); pending.current = null;
            if (restore) { const { timeline } = timelineFromDocument(r.document); onLoadTimeline(timeline); const need = refreshRelink(timeline); if (need.library.length) fetchLibrary(need.library, timeline); setPreview(null); setVersions(null); }
        } catch (e) {
            if (!alive.current) return;
            setError(saveProblem(e));
            if (e.status === 409) { try { setRemote(await gatewayFetch(`${endpoint}/document`)); } catch { /* the message already says to retry */ } }
        } finally { if (alive.current) setBusy(false); }
    }, [endpoint, doc, tl, revision, onLoadTimeline, refreshRelink, fetchLibrary]);
    // Autosave three seconds after the last edit, like the project page's draft, but only when nothing is in the way.
    useEffect(() => {
        clearTimeout(timer.current);
        if (dirty && !busy && !remote && !error) timer.current = setTimeout(() => save(), 3000);
        return () => clearTimeout(timer.current);
    }, [dirty, busy, remote, error, save]);

    async function chooseAgain(event) {
        const file = event.target.files[0]; event.target.value = '';
        if (!file) return;
        const ok = checkLocalFile(file);
        if (ok.error) { setError(ok.error); return; }
        const probe = await probeMedia(file);
        const bad = checkProbe(probe);
        if (bad) { setError(bad); return; }
        const match = matchLocalFile(tl, file, probe, new Set(blobs.current.keys()));
        if (!match) { setError(`That is not one of the files this project needs (same name and length).`); return; }
        blobs.current.set(match.id, file); setError(''); refreshRelink(tl); onRelinked();
    }
    async function openPicker() {
        setPicker({ projects: null, workspace: null, newName: '' });
        try {
            const w = await gatewayFetch('/workspaces');
            const workspace = w.workspaces?.[0]?.id || null;
            const rows = workspace ? await gatewayFetch(`/projects?workspace_id=${encodeURIComponent(workspace)}`) : { projects: [] };
            if (alive.current) setPicker({ projects: rows.projects || [], workspace, newName: '' });
        } catch (e) { if (alive.current) setPicker({ projects: [], workspace: null, newName: '', problem: e.status === 404 ? 'Projects are not switched on here.' : 'Could not load your projects.' }); }
    }
    async function attach(id, created = null) {
        setPicker(null);
        window.history.replaceState(null, '', `${window.location.pathname}?project=${encodeURIComponent(id)}`);
        // Open the project but keep the timeline being edited: save it as the first version of the editor's work there.
        setBusy(true); setError('');
        try {
            const d = await gatewayFetch(`/projects/${encodeURIComponent(id)}/document`);
            if (!alive.current) return;
            setProjectId(id); setName(created || 'Project'); setDoc(d.document); setRevision(d.revision); setSavedAt(d.created_at);
        } catch { if (alive.current) setError('Could not open the project.'); }
        finally { if (alive.current) setBusy(false); }
    }
    async function createProject() {
        const n = picker.newName.trim();
        if (!n || !picker.workspace) return;
        try {
            const r = await gatewayFetch('/projects', { method: 'POST', body: JSON.stringify({ workspace_id: picker.workspace, name: n }), headers: { 'idempotency-key': makeIdempotencyKey() } });
            await attach(r.project.id, r.project.name);
        } catch (e) { if (alive.current) setPicker(p => ({ ...p, problem: e.status === 429 ? 'Too many projects for now.' : 'Could not create the project.' })); }
    }
    async function openVersions() {
        setVersions([]);
        try { const r = await gatewayFetch(`${endpoint}/history`); if (alive.current) setVersions(r.versions || []); } catch { if (alive.current) setVersions(null); }
    }
    async function viewVersion(n) {
        try { const r = await gatewayFetch(`${endpoint}/document?revision=${n}`); if (alive.current) setPreview(r); } catch { if (alive.current) setError('Could not load that version.'); }
    }

    if (!enabled) return null;
    const status = busy ? 'Saving…' : error ? 'Not saved' : dirty ? 'Unsaved changes' : savedAt ? `Saved · version ${revision}` : 'Not saved yet';
    return <section aria-label="Project" className="space-y-3 rounded-2xl border border-vx-border bg-vx-panel p-4">
        <div className="flex flex-wrap items-center gap-3">
            {projectId ? <>
                <span className="text-sm font-bold">{name}</span>
                <span role="status" className="text-xs text-vx-fg-muted">{status}</span>
                <Button size="sm" disabled={busy || !dirty} onClick={() => save()}>Save</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={openVersions}>Versions</Button>
            </> : <Button size="sm" variant="ghost" disabled={busy} onClick={openPicker}>Save to a project</Button>}
            {relinking && <span role="status" className="text-xs text-vx-fg-muted">Fetching the project files…</span>}
        </div>
        {error && <p role="alert" className="text-sm">{error}</p>}
        {remote && <div className="rounded-xl border border-vx-accent p-3 text-sm"><p>Saved version {remote.revision} is newer than what you have.</p>
            <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const { timeline } = timelineFromDocument(remote.document); setDoc(remote.document); setRevision(remote.revision); setSavedAt(remote.created_at); setRemote(null); setError(''); onLoadTimeline(timeline); const need = refreshRelink(timeline); if (need.library.length) fetchLibrary(need.library, timeline); }}>Use saved version</Button>
                <Button size="sm" disabled={busy} onClick={() => save({ against: remote.revision })}>Save mine instead</Button>
            </div></div>}
        {relink.local.length > 0 && <div className="rounded-xl border border-vx-border p-3 text-sm">
            <p>This project needs files from your computer again (they were never uploaded):</p>
            <ul className="mt-1 list-disc pl-5">{relink.local.map(m => <li key={m.id}>{m.name}</li>)}</ul>
            <label className="mt-2 inline-flex cursor-pointer rounded-full border border-vx-border px-4 py-2 text-xs font-bold">Choose a file<input className="sr-only" type="file" accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a" onChange={chooseAgain} /></label>
        </div>}
        {relink.library.length > 0 && !relinking && <p className="text-xs text-vx-fg-muted">{relink.library.length} Library file(s) could not be fetched. <button type="button" className="underline" onClick={() => fetchLibrary(relink.library, tl)}>Try again</button></p>}
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
                {versions.map(v => <li key={v.revision}><button type="button" className={`${field} w-full text-left`} onClick={() => viewVersion(v.revision)}>Version {v.revision}{v.revision === revision ? ' · Current' : ''}<span className="block text-xs text-vx-fg-muted">{date(v.created_at)}{v.restored_from ? ` · restored from ${v.restored_from}` : ''}</span></button></li>)}
            </ol>}
            {preview && <div className="mt-4 rounded-xl border border-vx-border p-3 text-sm"><p className="font-bold">Version {preview.revision}</p><p className="text-xs text-vx-fg-muted">{date(preview.created_at)} · {preview.document.schema_version === 2 && preview.document.timeline ? `${preview.document.timeline.video.length} video clips, ${preview.document.timeline.audio.length} sounds, ${preview.document.timeline.text.length} texts` : 'no timeline'}</p>
                <p className="mt-2 text-xs text-vx-fg-muted">{dirty ? 'Save your current work before restoring.' : 'Restoring makes a new version; history is kept.'}</p>
                <Button size="sm" className="mt-2" disabled={busy || dirty || preview.revision === revision} onClick={() => save({ restore: preview.revision })}>Restore as new version</Button></div>}
            <div className="mt-4 flex justify-end"><Button size="sm" variant="ghost" onClick={() => { setVersions(null); setPreview(null); }}>Close</Button></div>
        </div></Modal>}
    </section>;
}
