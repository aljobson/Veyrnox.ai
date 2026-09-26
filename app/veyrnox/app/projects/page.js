'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../_components/NavBar';
import { Button } from '../../_components/Button';
import { Modal } from '../../_components/Modal';
import { gatewayFetch, makeIdempotencyKey } from '../../_lib/gateway';
import { useProjectsPreview } from '../../_lib/useProjectsPreview';

const field = 'w-full rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-sm text-vx-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent';
function errorMessage(error) {
  if (error.code === 'account_changed') return 'Your account changed. Reload this page to continue.';
  if (error.status === 401) return 'Sign in to view your projects.';
  if (error.status === 403) return 'You do not have permission to make this change.';
  if (error.status === 404) return 'This project or workspace is no longer available.';
  if (error.status === 409) return 'This project changed in another window. Reload its latest version before trying again.';
  if (error.status === 429) return 'Too many changes. Wait a minute and try again.';
  return 'We could not reach your projects. Try again.';
}

export default function Projects() {
  const enabled = useProjectsPreview();
  const [workspaces, setWorkspaces] = useState([]);
  const [workspace, setWorkspace] = useState('');
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);

  const load = useCallback(async (selected = '') => {
    const current = ++sequence.current;
    setLoading(true); setError(''); setProjects([]);
    try {
      const result = await gatewayFetch('/workspaces');
      if (current !== sequence.current) return;
      setWorkspaces(result.workspaces);
      const id = result.workspaces.find(w => w.id === selected)?.id || result.workspaces[0]?.id || '';
      setWorkspace(id);
      if (id) {
        const rows = await gatewayFetch(`/projects?workspace_id=${encodeURIComponent(id)}`);
        if (current !== sequence.current) return;
        setProjects(rows.projects);
      }
    } catch (e) { if (current === sequence.current) setError(errorMessage(e)); }
    finally { if (current === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const tracker = sequence;
    if (enabled) load();
    return () => { tracker.current++; };
  }, [enabled, load]);

  function saved(project, mode) {
    setDialog(null);
    setProjects(rows => mode === 'delete' ? rows.filter(p => p.id !== project.id)
      : mode === 'create' ? [project, ...rows.filter(p => p.id !== project.id)]
        : rows.map(p => p.id === project.id ? project : p));
    setNotice(mode === 'delete' ? 'Project deleted.' : mode === 'create' ? 'Project created.' : 'Project renamed.');
  }
  const shown = projects.filter(p => p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <>
    <AppNav active="projects" />
    <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div><p className="mb-2 font-vx-mono text-xs uppercase tracking-widest text-vx-accent">Your workspace</p>
          <h1 className="text-3xl font-black sm:text-4xl">Projects</h1>
          <p className="mt-3 max-w-lg text-sm text-vx-fg-muted">A home for your next idea. Create and manage projects in your workspace.</p></div>
        {enabled && <Button disabled={loading || !!error || !workspace} onClick={() => { setNotice(''); setDialog({ mode: 'create' }); }}>New project</Button>}
      </div>
      {!enabled ? <section className="rounded-2xl border border-vx-border p-8"><h2 className="text-lg font-bold">Projects preview</h2><p className="mt-2 text-vx-fg-muted">Projects are not available in this browser yet.</p><Link className="mt-5 inline-block text-vx-accent underline" href="/app">Back to Explore</Link></section> : <>
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-bold text-vx-fg-muted">Workspace
            <select className={`${field} mt-2`} value={workspace} disabled={loading || !workspaces.length} onChange={e => { setWorkspace(e.target.value); setQuery(''); setNotice(''); load(e.target.value); }}>
              {!workspaces.length && <option value="">{loading ? 'Loading workspaces…' : 'No workspace available'}</option>}
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
          <label className="text-xs font-bold text-vx-fg-muted">Find a project
            <input type="search" className={`${field} mt-2`} placeholder="Search by name" value={query} onChange={e => setQuery(e.target.value)} /></label>
        </div>
        <p role="status" className="mb-3 min-h-5 text-sm text-vx-accent">{notice}</p>
        {error ? <div role="alert" className="rounded-2xl border border-vx-border p-8"><p className="mb-4">{error}</p><Button variant="ghost" onClick={() => load(workspace)}>Try again</Button></div>
          : loading ? <p role="status" className="py-16 text-center text-vx-fg-muted">Loading your projects…</p>
            : !workspace ? <div className="rounded-2xl border border-vx-border p-10 text-center"><h2 className="text-xl font-bold">No workspace available</h2><p className="mt-3 text-vx-fg-muted">Ask your workspace owner for access, or try again later.</p></div>
              : !projects.length ? <section className="rounded-2xl border border-dashed border-vx-border px-6 py-16 text-center"><span aria-hidden="true" className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-vx-panel text-2xl text-vx-accent">＋</span><h2 className="text-xl font-bold">Start with a project</h2><p className="mx-auto mb-6 mt-3 max-w-sm text-sm text-vx-fg-muted">Give your idea a name. You can change it whenever you need.</p><Button onClick={() => setDialog({ mode: 'create' })}>Create your first project</Button></section>
                : <section aria-label="Projects" className="overflow-hidden rounded-2xl border border-vx-border">
                  <div className="flex items-center justify-between border-b border-vx-border bg-vx-panel px-5 py-3 text-xs text-vx-fg-muted"><span>{shown.length} {shown.length === 1 ? 'project' : 'projects'}</span><span>Newest first</span></div>
                  {!shown.length ? <p className="p-10 text-center text-vx-fg-muted">No projects match “{query}”.</p> : <ul className="divide-y divide-vx-border">{shown.map(p => <li key={p.id} className="flex flex-col items-start justify-between gap-4 px-5 py-5 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1"><h2 className="break-words font-bold"><Link className="hover:text-vx-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent" href={`/app/projects/${encodeURIComponent(p.id)}`}>{p.name}</Link></h2><p className="mt-1 text-xs text-vx-fg-muted">Created {new Date(p.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
                    <div className="flex gap-2"><Button size="sm" variant="ghost" aria-label={`Rename ${p.name}`} onClick={() => setDialog({ mode: 'rename', project: p })}>Rename</Button><Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDialog({ mode: 'delete', project: p })}>Delete</Button></div>
                  </li>)}</ul>}
                </section>}
        {projects.length >= 100 && <p className="mt-3 text-sm text-vx-fg-muted">Showing the 100 most recent projects. Search filters this list.</p>}
        <p className="mt-6 text-xs text-vx-fg-muted">Looking for generated images, video or audio? <Link href="/app/library" className="text-vx-accent underline">Open your library</Link></p>
      </>}
      {dialog && <ProjectDialog {...dialog} workspace={workspace} onClose={() => setDialog(null)} onSaved={saved} />}
    </main>
  </>;
}

function ProjectDialog({ mode, project, workspace, onClose, onSaved }) {
  const [name, setName] = useState(project?.name || '');
  const [version, setVersion] = useState(project?.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const input = useRef(null);
  const pending = useRef(null);
  const inFlight = useRef(false);
  const removing = mode === 'delete';
  const title = removing ? 'Delete project?' : mode === 'create' ? 'New project' : 'Rename project';
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || conflict) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      let result;
      if (mode === 'create') {
        const body = JSON.stringify({ workspace_id: workspace, name: name.trim() });
        // Keep the same key after an uncertain response so retry cannot duplicate a project.
        if (pending.current?.body !== body) pending.current = { body, key: makeIdempotencyKey() };
        result = await gatewayFetch('/projects', { method: 'POST', body, headers: { 'idempotency-key': pending.current.key } });
      } else {
        result = await gatewayFetch(`/projects/${encodeURIComponent(project.id)}`, { method: removing ? 'DELETE' : 'PATCH', body: JSON.stringify({ version, ...(removing ? {} : { name: name.trim() }) }) });
      }
      onSaved(result.project, mode);
    } catch (e) { setError(errorMessage(e)); setConflict(e.status === 409 && e.code !== 'account_changed' && mode !== 'create'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await gatewayFetch(`/projects/${encodeURIComponent(project.id)}`);
      setVersion(result.project.version); setConflict(false);
      setError(`Latest project name: “${result.project.name}”. Review your change and submit again.`);
    } catch (e) { setError(errorMessage(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Modal aria-labelledby="project-dialog-title" onCancel={() => !busy && onClose()} initialFocusRef={input} className="items-center justify-center p-4">
    <form onSubmit={submit} className="w-full max-w-lg rounded-2xl border border-vx-border bg-vx-base p-6 sm:p-8">
      <h2 id="project-dialog-title" className="mb-3 text-2xl font-black">{title}</h2>
      {removing ? <p className="mb-6 break-words text-sm text-vx-fg-muted">“{project.name}” will be removed from this workspace. Generated media in your library stays there.</p>
        : <label className="block text-sm font-semibold">Project name<input ref={input} className={`${field} mb-2 mt-3`} value={name} onChange={e => setName(e.target.value)} maxLength={120} required disabled={busy} autoComplete="off" /><span className="text-xs font-normal text-vx-fg-muted">Choose a name you will recognise. Up to 120 characters.</span></label>}
      {error && <p role="alert" className="mt-4 text-sm text-vx-fg-body">{error}</p>}
      <div className="mt-7 flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        {conflict ? <Button type="button" disabled={busy} onClick={reload}>{busy ? 'Loading…' : 'Reload project'}</Button>
          : <Button type="submit" variant={removing ? 'danger' : 'primary'} disabled={busy || (!removing && !name.trim())}>{busy ? 'Saving…' : removing ? 'Delete project' : mode === 'create' ? 'Create project' : 'Save name'}</Button>}
      </div>
    </form>
  </Modal>;
}
