'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from './Button';
import { gatewayFetch, makeIdempotencyKey } from '../_lib/gateway';
import { buildPerformanceProjectManifest, parsePerformanceProjectManifest } from '../_lib/performanceProjectManifest';
import { performanceProjectSnapshot } from '../../../lib/performanceProjectSnapshot';

const field = 'w-full rounded-xl border border-vx-border bg-vx-base px-3 py-2 text-xs text-vx-fg focus:border-vx-accent focus:outline-hidden';

export function SavePerformanceProject({ project, allowedWorkflowIds, className = '' }) {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);

  async function loadProjects(nextWorkspace) {
    setBusy(true); setStatus(''); setError(false); setProjects([]); setProjectId('');
    try {
      const rows = await gatewayFetch(`/projects?workspace_id=${encodeURIComponent(nextWorkspace)}`);
      setProjects(rows.projects);
      setProjectId(rows.projects[0]?.id || '');
    } catch {
      setError(true); setStatus('Projects could not be loaded. Sign in and try again.');
    } finally { setBusy(false); }
  }

  async function reveal() {
    if (open) { setOpen(false); return; }
    setOpen(true); setBusy(true); setStatus(''); setError(false);
    try {
      const result = await gatewayFetch('/workspaces');
      setWorkspaces(result.workspaces);
      const first = result.workspaces[0]?.id || '';
      setWorkspaceId(first);
      if (first) await loadProjects(first);
      else setStatus('Create or join a workspace before saving a project.');
    } catch {
      setError(true); setStatus('Sign in to save this workflow to Projects.');
    } finally { setBusy(false); }
  }

  async function save() {
    if (!projectId || busy) return;
    setBusy(true); setStatus(''); setError(false);
    try {
      const manifest = buildPerformanceProjectManifest(project);
      const draft = parsePerformanceProjectManifest(manifest, { allowedWorkflowIds });
      const snapshot = performanceProjectSnapshot(manifest, draft);
      if (!snapshot) throw new Error('invalid_snapshot');
      const current = await gatewayFetch(`/projects/${encodeURIComponent(projectId)}/document`);
      const document = { ...current.document, schema_version: 2, performance: snapshot };
      await gatewayFetch(`/projects/${encodeURIComponent(projectId)}/document`, {
        method: 'PUT',
        body: JSON.stringify({ expected_revision: current.revision, document }),
        headers: { 'idempotency-key': makeIdempotencyKey() },
        signal: AbortSignal.timeout(15000),
      });
      setStatus('Saved to Projects. Media, consent and the current quote must still be reviewed when reopened.');
    } catch (next) {
      setError(true);
      setStatus(next?.status === 409 ? 'That project changed elsewhere. Reload it, then save again.' : 'The project could not be saved. Your current Studio work is unchanged.');
    } finally { setBusy(false); }
  }

  return <div className="contents">
    <button type="button" onClick={reveal} className={className}>{open ? 'Close project save' : 'Save to Projects'}</button>
    {open && <section className="basis-full rounded-xl border border-vx-border bg-vx-base p-4" aria-label="Save workflow to a project">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[11px] font-bold text-vx-fg-muted">Workspace
          <select className={`${field} mt-1`} value={workspaceId} disabled={busy || !workspaces.length} onChange={(event) => { setWorkspaceId(event.target.value); loadProjects(event.target.value); }}>
            {!workspaces.length && <option value="">No workspace loaded</option>}
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-bold text-vx-fg-muted">Project
          <select className={`${field} mt-1`} value={projectId} disabled={busy || !projects.length} onChange={(event) => setProjectId(event.target.value)}>
            {!projects.length && <option value="">No projects available</option>}
            {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3"><Button size="sm" disabled={busy || !projectId} onClick={save}>{busy ? 'Saving…' : 'Save workflow snapshot'}</Button><Link href="/app/projects" className="text-xs font-bold text-vx-accent underline">Manage Projects</Link></div>
      {status && <p role={error ? 'alert' : 'status'} className={`mt-3 text-[11px] leading-5 ${error ? 'text-vx-danger' : 'text-vx-fg-muted'}`}>{status}</p>}
      <p className="mt-3 text-[10px] leading-4 text-vx-fg-faint">Stores editable settings, safe source descriptions, quote provenance and job IDs. It never stores file bytes, signed URLs, access tokens or reusable consent.</p>
    </section>}
  </div>;
}
