'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { Button } from '../../_components/Button';
import { Modal } from '../../_components/Modal';
import { gatewayFetch, makeIdempotencyKey } from '../../_lib/gateway';
import { useProjectsEnabled } from '../../_components/ProjectsFlag';
import { ProjectThumb } from '../../_components/JobThumb';
import { SmartCutBatchQueue } from '../../_components/SmartCutBatchQueue';

const field = 'w-full rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-sm text-vx-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const savedClock = seconds => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600), minutes = Math.floor(safe % 3600 / 60), remainder = safe % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
};
const folderPath = (folder, folders) => {
  const names = [folder.name]; let parent = folder.parent_id; const seen = new Set([folder.id]);
  while (parent && names.length < 4 && !seen.has(parent)) {
    seen.add(parent); const match = folders.find(item => item.id === parent); if (!match) break;
    names.unshift(match.name); parent = match.parent_id;
  }
  return names.join(' / ');
};
const folderDepth = (folder, folders) => folderPath(folder, folders).split(' / ').length;
function errorMessage(error, t) {
  if (error.code === 'account_changed') return t("app.projects.accountChanged");
  if (error.status === 401) return t("app.projects.signIn");
  if (error.status === 403) return t("app.projects.permission");
  if (error.status === 404) return t("app.projects.workspaceGone");
  if (error.code === 'NAME_CONFLICT') return t('app.projects.folderNameConflict');
  if (error.code === 'FOLDER_NOT_EMPTY') return t('app.projects.folderNotEmpty');
  if (error.code === 'FOLDER_DEPTH_LIMIT') return t('app.projects.folderDepthLimit');
  if (error.code === 'LIMIT_REACHED') return t('app.projects.folderLimitReached');
  if (error.status === 409) return t("app.projects.changedElsewhere");
  if (error.status === 429) return t("app.projects.tooMany");
  return t("app.projects.reachFailed");
}

export default function Projects() {
  const { t, locale } = useI18n();
  const enabled = useProjectsEnabled();
  const [workspaces, setWorkspaces] = useState([]);
  const [workspace, setWorkspace] = useState('');
  const [projects, setProjects] = useState([]);
  const [folders, setFolders] = useState([]);
  const [folderFilter, setFolderFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const [moveError, setMoveError] = useState('');
  const [movingProjectId, setMovingProjectId] = useState('');
  const sequence = useRef(0);

  const load = useCallback(async (selected = '') => {
    const current = ++sequence.current;
    setLoading(true); setError(''); setProjects([]); setFolders([]);
    try {
      const result = await gatewayFetch('/workspaces');
      if (current !== sequence.current) return;
      setWorkspaces(result.workspaces);
      const id = result.workspaces.find(w => w.id === selected)?.id || result.workspaces[0]?.id || '';
      setWorkspace(id);
      if (id) {
        const [rows, folderRows] = await Promise.allSettled([
          gatewayFetch(`/projects?workspace_id=${encodeURIComponent(id)}`),
          gatewayFetch(`/project-folders?workspace_id=${encodeURIComponent(id)}`),
        ]);
        if (current !== sequence.current) return;
        if (rows.status === 'rejected') throw rows.reason;
        setProjects(rows.value.projects);
        setFolders(folderRows.status === 'fulfilled' ? folderRows.value.folders : []);
        setFolderFilter('all');
      }
    } catch (e) { if (current === sequence.current) setError(errorMessage(e, t)); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [t]);
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
    setNotice(mode === 'delete' ? t("app.projects.deleted") : mode === 'create' ? t("app.projects.created") : t("app.projects.renamed"));
  }
  function folderSaved(folder, mode) {
    setDialog(null);
    setFolders(rows => mode === 'delete' ? rows.filter(item => item.id !== folder.id)
      : mode === 'create' ? [...rows.filter(item => item.id !== folder.id), folder]
        : rows.map(item => item.id === folder.id ? folder : item));
    if (mode === 'delete') setFolderFilter('all');
    setNotice(mode === 'delete' ? t('app.projects.folderDeleted') : mode === 'create' ? t('app.projects.folderCreated') : t('app.projects.folderRenamed'));
  }
  async function moveProject(project, folderId) {
    if (movingProjectId) return;
    setNotice(''); setMoveError(''); setMovingProjectId(project.id);
    try {
      const result = await gatewayFetch(`/projects/${encodeURIComponent(project.id)}`, { method: 'PATCH', body: JSON.stringify({ folder_id: folderId || null, version: project.version }) });
      setProjects(rows => rows.map(item => item.id === project.id ? result.project : item));
      setNotice(t('app.projects.projectMoved'));
    } catch (e) {
      setMoveError(errorMessage(e, t));
      if (e.status === 409 && workspace) {
        try {
          const latest = await gatewayFetch(`/projects?workspace_id=${encodeURIComponent(workspace)}`);
          setProjects(latest.projects);
        } catch { /* Keep the visible list and let the user retry explicitly. */ }
      }
    } finally { setMovingProjectId(''); }
  }
  const shown = projects.filter(p => p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    && (folderFilter === 'all' || (folderFilter === 'unfiled' ? !p.folder_id : p.folder_id === folderFilter)));
  const selectedFolder = folders.find(folder => folder.id === folderFilter);
  return <>
    <AppNav active="projects" />
    <Main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div><p className="mb-2 font-vx-mono text-xs uppercase tracking-widest text-vx-accent">{t("app.projects.yourWorkspace")}</p>
          <h1 className="text-3xl font-black sm:text-4xl">{t("label.Projects")}</h1>
          <p className="mt-3 max-w-lg text-sm text-vx-fg-muted">{t("app.projects.intro")}</p></div>
        {enabled && <Button data-testid="project-new" disabled={loading || !!error || !workspace} onClick={() => { setNotice(''); setDialog({ mode: 'create' }); }}>{t("cinema.creator.newProject")}</Button>}
      </div>
      {!enabled ? <section className="rounded-2xl border border-vx-border p-8"><h2 className="text-lg font-bold">{t("app.projects.preview")}</h2><p className="mt-2 text-vx-fg-muted">{t("app.projects.notAvailable")}</p><Link className="mt-5 inline-block text-vx-accent underline" href="/app">{t("app.projects.backExplore")}</Link></section> : <>
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <label className="text-xs font-bold text-vx-fg-muted">{t("app.projects.workspace")}<select className={`${field} mt-2`} value={workspace} disabled={loading || !workspaces.length} onChange={e => { setWorkspace(e.target.value); setQuery(''); setNotice(''); load(e.target.value); }}>
              {!workspaces.length && <option value="">{loading ? t("app.projects.loadingWorkspaces") : t("app.projects.noWorkspace")}</option>}
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
          <label className="text-xs font-bold text-vx-fg-muted">{t("app.projects.find")}<input data-testid="project-search" type="search" className={`${field} mt-2`} data-assistant-target="projects.search" placeholder={t("app.projects.search")} value={query} onChange={e => setQuery(e.target.value)} /></label>
          <label className="text-xs font-bold text-vx-fg-muted">{t('app.projects.folder')}<select data-testid="project-folder-filter" className={`${field} mt-2`} value={folderFilter} onChange={e => setFolderFilter(e.target.value)}>
            <option value="all">{t('app.projects.allFolders')}</option><option value="unfiled">{t('app.projects.unfiled')}</option>
            {folders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(folder, folders)}</option>)}
          </select></label>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" data-testid="folder-new" disabled={selectedFolder ? folderDepth(selectedFolder, folders) >= 4 : false} onClick={() => setDialog({ mode: 'folder-create', parentId: selectedFolder?.id || null })}>{t('app.projects.newFolder')}</Button>
          {selectedFolder ? <><Button size="sm" variant="ghost" onClick={() => setDialog({ mode: 'folder-rename', folder: selectedFolder })}>{t('app.projects.renameFolder')}</Button><Button size="sm" variant="ghost" onClick={() => setDialog({ mode: 'folder-delete', folder: selectedFolder })}>{t('app.projects.deleteFolder')}</Button></> : null}
        </div>
        <p role="status" className="mb-3 min-h-5 text-sm text-vx-accent">{notice}</p>
        {moveError ? <p role="alert" className="mb-3 text-sm text-vx-fg-body">{moveError}</p> : null}
        {!loading && !error && workspace && projects.length > 1 ? <SmartCutBatchQueue workspaceId={workspace} projects={projects} /> : null}
        {error ? <div role="alert" className="rounded-2xl border border-vx-border p-8"><p className="mb-4">{error}</p><Button variant="ghost" onClick={() => load(workspace)}>{t("recovery.retry")}</Button></div>
          : loading ? <p role="status" className="py-16 text-center text-vx-fg-muted">{t("app.projects.loadingList")}</p>
            : !workspace ? <div className="rounded-2xl border border-vx-border p-10 text-center"><h2 className="text-xl font-bold">{t("app.projects.noWorkspace")}</h2><p className="mt-3 text-vx-fg-muted">{t("app.projects.askOwner")}</p></div>
              : !projects.length ? <section className="rounded-2xl border border-dashed border-vx-border px-6 py-16 text-center"><span aria-hidden="true" className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-vx-panel text-2xl text-vx-accent">＋</span><h2 data-testid="project-start" className="text-xl font-bold">{t("app.projects.start")}</h2><p className="mx-auto mb-6 mt-3 max-w-sm text-sm text-vx-fg-muted">{t("app.projects.nameIdea")}</p><Button onClick={() => setDialog({ mode: 'create' })}>{t("app.projects.first")}</Button></section>
                : <section aria-label={t("label.Projects")} className="overflow-hidden rounded-2xl border border-vx-border">
                  <div className="flex items-center justify-between border-b border-vx-border bg-vx-panel px-5 py-3 text-xs text-vx-fg-muted"><span>{t(pluralKey(t, locale, 'app.projects.count', shown.length), { count: locale === 'en' ? String(shown.length) : shown.length.toLocaleString(localeTag(locale)) })}</span><span>{t("app.projects.newest")}</span></div>
                  {!shown.length ? <p data-testid="project-no-match" className="p-10 text-center text-vx-fg-muted">{t('app.projects.noMatch', { query })}</p> : <ul className="divide-y divide-vx-border">{shown.map(p => <li key={p.id} className="flex flex-col items-start justify-between gap-4 px-5 py-5 sm:flex-row sm:items-center">
                    <ProjectThumb projectId={p.id} size={64} />
                    <div className="min-w-0 flex-1"><h2 className="wrap-break-word font-bold"><Link className="hover:text-vx-accent focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent" href={`/app/projects/${encodeURIComponent(p.id)}`}>{p.name}</Link></h2><p className="mt-1 text-xs text-vx-fg-muted">{t('app.projects.createdAt', { date: new Date(p.created_at).toLocaleDateString(localeTag(locale), { day: 'numeric', month: 'short', year: 'numeric' }) })}</p>
                      {p.editing_time_saved_seconds ? <p className="mt-1 text-xs font-semibold text-vx-accent" data-testid={`project-time-saved-${p.id}`}>{t('app.projects.editingTimeSaved', { duration: savedClock(p.editing_time_saved_seconds) })}</p> : null}</div>
                    <div className="flex flex-wrap items-center gap-2"><label className="text-xs text-vx-fg-muted">{t('app.projects.moveTo')}<select data-testid={`project-folder-${p.id}`} className="ml-2 rounded-lg border border-vx-border bg-vx-base px-2 py-2" value={p.folder_id || ''} disabled={movingProjectId === p.id} onChange={e => void moveProject(p, e.target.value)}><option value="">{t('app.projects.unfiled')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(folder, folders)}</option>)}</select></label><Button data-testid={`project-rename-${p.id}`} size="sm" variant="ghost" aria-label={t('app.projects.renameLabel', { name: p.name })} onClick={() => setDialog({ mode: 'rename', project: p })}>{t("app.projects.rename")}</Button><Button data-testid={`project-delete-${p.id}`} size="sm" variant="ghost" aria-label={t('app.projects.deleteLabel', { name: p.name })} onClick={() => setDialog({ mode: 'delete', project: p })}>{t("app.publish.composer.delete")}</Button></div>
                  </li>)}</ul>}
                </section>}
        {projects.length >= 100 && <p className="mt-3 text-sm text-vx-fg-muted">{t("app.projects.limit")}</p>}
        <p className="mt-6 text-xs text-vx-fg-muted">{t("app.projects.lookingMedia")}<Link href="/app/library" className="text-vx-accent underline">{t("recovery.library")}</Link></p>
      </>}
      {dialog && String(dialog.mode).startsWith('folder-') ? <FolderDialog {...dialog} workspace={workspace} folders={folders} onClose={() => setDialog(null)} onSaved={folderSaved} /> : null}
      {dialog && !String(dialog.mode).startsWith('folder-') ? <ProjectDialog {...dialog} workspace={workspace} onClose={() => setDialog(null)} onSaved={saved} /> : null}
    </Main>
  </>;
}

function FolderDialog({ mode, folder, parentId, workspace, folders, onClose, onSaved }) {
  const { t } = useI18n();
  const [name, setName] = useState(folder?.name || '');
  const [parent, setParent] = useState(parentId || '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const key = useRef(makeIdempotencyKey());
  const removing = mode === 'folder-delete';
  async function submit(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const result = mode === 'folder-create'
        ? await gatewayFetch('/project-folders', { method: 'POST', headers: { 'idempotency-key': key.current }, body: JSON.stringify({ workspace_id: workspace, parent_id: parent || null, name: name.trim() }) })
        : await gatewayFetch(`/project-folders/${encodeURIComponent(folder.id)}`, { method: removing ? 'DELETE' : 'PATCH', body: JSON.stringify({ version: folder.version, ...(removing ? {} : { name: name.trim() }) }) });
      onSaved(result.folder, removing ? 'delete' : mode === 'folder-create' ? 'create' : 'rename');
    } catch (e) { setError(errorMessage(e, t)); }
    finally { setBusy(false); }
  }
  return <Modal aria-labelledby="folder-dialog-title" onCancel={() => !busy && onClose()} className="items-center justify-center p-4"><form onSubmit={submit} className="w-full max-w-lg rounded-2xl border border-vx-border bg-vx-base p-6 sm:p-8">
    <h2 id="folder-dialog-title" className="mb-4 text-2xl font-black">{removing ? t('app.projects.deleteFolderQuestion') : mode === 'folder-create' ? t('app.projects.newFolder') : t('app.projects.renameFolder')}</h2>
    {removing ? <p className="text-sm text-vx-fg-muted">{t('app.projects.deleteFolderHelp')}</p> : <><label className="block text-sm font-semibold">{t('app.projects.folderName')}<input className={`${field} mb-4 mt-2`} value={name} onChange={e => setName(e.target.value)} maxLength={120} required autoFocus /></label>{mode === 'folder-create' ? <label className="block text-sm font-semibold">{t('app.projects.parentFolder')}<select className={`${field} mt-2`} value={parent} onChange={e => setParent(e.target.value)}><option value="">{t('app.projects.topLevel')}</option>{folders.filter(item => folderDepth(item, folders) < 4).map(item => <option key={item.id} value={item.id}>{folderPath(item, folders)}</option>)}</select></label> : null}</>}
    {error ? <p role="alert" className="mt-4 text-sm">{error}</p> : null}<div className="mt-7 flex justify-end gap-3"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t('cinema.creatorWorkspace.cancel')}</Button><Button type="submit" variant={removing ? 'danger' : 'primary'} disabled={busy || (!removing && !name.trim())}>{busy ? t('social.saving') : removing ? t('app.projects.deleteFolder') : t('app.projects.saveFolder')}</Button></div>
  </form></Modal>;
}

function ProjectDialog({ mode, project, workspace, onClose, onSaved }) {
  const { t } = useI18n();
  const [name, setName] = useState(project?.name || '');
  const [version, setVersion] = useState(project?.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const input = useRef(null);
  const pending = useRef(null);
  const inFlight = useRef(false);
  const removing = mode === 'delete';
  const title = removing ? t("app.projects.deleteQuestion") : mode === 'create' ? t("cinema.creator.newProject") : t("app.projects.renameProject");
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
    } catch (e) { setError(errorMessage(e, t)); setConflict(e.status === 409 && e.code !== 'account_changed' && mode !== 'create'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await gatewayFetch(`/projects/${encodeURIComponent(project.id)}`);
      setVersion(result.project.version); setConflict(false);
      setError(t('app.projects.latestName', { name: result.project.name }));
    } catch (e) { setError(errorMessage(e, t)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Modal aria-labelledby="project-dialog-title" onCancel={() => !busy && onClose()} initialFocusRef={input} className="items-center justify-center p-4">
    <form onSubmit={submit} className="w-full max-w-lg rounded-2xl border border-vx-border bg-vx-base p-6 sm:p-8">
      <h2 id="project-dialog-title" className="mb-3 text-2xl font-black">{title}</h2>
      {removing ? <p className="mb-6 wrap-break-word text-sm text-vx-fg-muted">{t('app.projects.deleteHelp', { name: project.name })}</p>
        : <label className="block text-sm font-semibold">{t("app.projects.name")}<input ref={input} className={`${field} mb-2 mt-3`} value={name} onChange={e => setName(e.target.value)} maxLength={120} required disabled={busy} autoComplete="off" /><span className="text-xs font-normal text-vx-fg-muted">{t("app.projects.nameHelp")}</span></label>}
      {error && <p role="alert" className="mt-4 text-sm text-vx-fg-body">{error}</p>}
      <div className="mt-7 flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t("cinema.creatorWorkspace.cancel")}</Button>
        {conflict ? <Button type="button" disabled={busy} onClick={reload}>{busy ? t("cinema.titlePage.loading") : t("app.projects.reload")}</Button>
          : <Button data-testid="project-submit" type="submit" variant={removing ? 'danger' : 'primary'} disabled={busy || (!removing && !name.trim())}>{busy ? t("social.saving") : removing ? t("app.projects.delete") : mode === 'create' ? t("app.projects.create") : t("app.projects.saveName")}</Button>}
      </div>
    </form>
  </Modal>;
}
