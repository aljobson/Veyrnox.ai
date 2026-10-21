'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useId, useMemo, useState } from 'react';
import { ALL_CHATS, UNFILED, visibleThreads } from '../../_lib/chatFolders';

const field = 'rounded-full border bg-vx-base px-3 py-2 text-sm text-vx-fg';

// Search, pin, rename, move and delete. Delete asks first. Pinned chats sort first. Folders group chats: pick one to
// narrow the list; deleting a folder keeps its chats. `folders` is null when folders are not available, and then none of
// the folder controls show.
export function ThreadList({ threads, folders = null, folder = ALL_CHATS, onFolder, onNewFolder, onRenameFolder, onDeleteFolder, onMove, activeId, onOpen, onNew, onPatch, onDelete }) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : Number(value).toLocaleString(localeTag(locale));
  const searchId = useId();
  const folderId = useId();
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [moving, setMoving] = useState(null);
  const [folderMode, setFolderMode] = useState(null); // null | 'new' | 'rename' | 'delete'
  const [folderDraft, setFolderDraft] = useState('');
  const shown = useMemo(() => visibleThreads(threads, { query, folder }), [threads, query, folder]);
  const unfiled = threads.filter((thread) => !thread.folder_id).length;
  const current = folders ? folders.find((f) => f.id === folder) : null;
  const commit = (id) => { const title = draft.trim(); setRenaming(null); if (title) onPatch(id, { title }); };
  const commitFolder = async () => {
    const name = folderDraft.trim(); const mode = folderMode;
    if (!name) { setFolderMode(null); return; }
    const ok = mode === 'new' ? await onNewFolder(name) : await onRenameFolder(current.id, name);
    if (ok) setFolderMode(null);
  };
  const choose = (value) => { setFolderMode(null); onFolder(value); };

  return (
    <nav data-assistant-target="chat.threads" aria-label={t("app.chat.chats")} className="flex h-full flex-col gap-2 p-3">
      <button type="button" onClick={onNew} className="rounded-full bg-vx-accent px-4 py-2.5 text-center text-sm font-semibold text-vx-accent-ink hover:bg-vx-accent-hover">{t("app.chat.threads.new")}</button>
      <label className="sr-only" htmlFor={searchId}>{t("app.chat.threads.search")}</label>
      <input id={searchId} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("app.chat.threads.search")}
        className={`${field} border-vx-border placeholder:text-vx-fg-faint`} />

      {folders && (
        <div className="space-y-1">
          <label className="sr-only" htmlFor={folderId}>{t("app.chat.threads.folder")}</label>
          <select id={folderId} value={current ? folder : folder === UNFILED ? UNFILED : ALL_CHATS} onChange={(e) => choose(e.target.value)}
            className={`w-full ${field} border-vx-border`}>
            <option value={ALL_CHATS}>{t('app.chat.threads.all', { count: number(threads.length) })}</option>
            <option value={UNFILED}>{t('app.chat.threads.unfiled', { count: number(unfiled) })}</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{`${f.name} (${number(f.count)})`}</option>)}
          </select>
          {folderMode === 'new' || folderMode === 'rename' ? (
            <input autoFocus aria-label={folderMode === 'new' ? t("app.chat.threads.newFolderName") : t("app.chat.threads.folderName")} maxLength={60} value={folderDraft}
              onChange={(e) => setFolderDraft(e.target.value)} onBlur={commitFolder}
              onKeyDown={(e) => { if (e.key === 'Enter') commitFolder(); if (e.key === 'Escape') setFolderMode(null); }}
              className={`w-full ${field} border-vx-accent`} />
          ) : folderMode === 'delete' && current ? (
            <div role="alert" className="flex items-center gap-3 rounded-lg bg-vx-border/50 px-3 py-2 text-sm">
              <span className="flex-1">{t("app.chat.threads.deleteFolderConfirm")}</span>
              <button type="button" className="font-semibold text-vx-danger" onClick={() => { setFolderMode(null); onDeleteFolder(current.id); }}>{t("app.publish.composer.delete")}</button>
              <button type="button" onClick={() => setFolderMode(null)}>{t("app.chat.threads.keep")}</button>
            </div>
          ) : (
            <div className="flex gap-1 text-xs">
              <button type="button" className="rounded-sm px-2 py-1 hover:bg-vx-border/50" onClick={() => { setFolderDraft(''); setFolderMode('new'); }}>{t("app.chat.threads.newFolder")}</button>
              {current && <button type="button" className="rounded-sm px-2 py-1 hover:bg-vx-border/50" aria-label={t('app.chat.threads.renameFolder', { name: current.name })} onClick={() => { setFolderDraft(current.name); setFolderMode('rename'); }}>{t("app.projects.rename")}</button>}
              {current && <button type="button" className="rounded-sm px-2 py-1 hover:bg-vx-border/50" aria-label={t('app.chat.threads.deleteFolder', { name: current.name })} onClick={() => setFolderMode('delete')}>{t("app.publish.composer.delete")}</button>}
            </div>
          )}
        </div>
      )}

      <ul className="mt-1 flex-1 space-y-1 overflow-y-auto">
        {threads.length === 0 && <li className="px-2 py-3 text-sm text-vx-fg-muted">{t("app.chat.threads.empty")}</li>}
        {threads.length > 0 && shown.length === 0 && (
          <li className="px-2 py-3 text-sm text-vx-fg-muted">
            {query.trim() ? t("app.chat.threads.noMatches") : folder === UNFILED ? t("app.chat.threads.allFiled") : t("app.chat.threads.emptyFolder")}
          </li>
        )}
        {shown.map((thread) => (
          <li key={thread.id} className="group relative">
            {renaming === thread.id ? (
              <input autoFocus aria-label={t("app.chat.threads.chatName")} maxLength={120} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(thread.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(thread.id); if (e.key === 'Escape') setRenaming(null); }}
                className={`w-full ${field} border-vx-accent`} />
            ) : moving === thread.id && folders ? (
              <select autoFocus aria-label={t('app.chat.threads.moveTo', { name: thread.title })} value={thread.folder_id || ''} onBlur={() => setMoving(null)}
                onKeyDown={(e) => { if (e.key === 'Escape') setMoving(null); }}
                onChange={(e) => { const to = e.target.value || null; setMoving(null); onMove(thread.id, to); }}
                className={`w-full ${field} border-vx-accent`}>
                <option value="">{t("app.chat.threads.noFolder")}</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            ) : confirm === thread.id ? (
              <div role="alert" className="flex items-center gap-3 rounded-lg bg-vx-border/50 px-3 py-2 text-sm">
                <span className="flex-1">{t("app.chat.threads.deleteConfirm")}</span>
                <button type="button" className="font-semibold text-vx-danger" onClick={() => { setConfirm(null); onDelete(thread.id); }}>{t("app.publish.composer.delete")}</button>
                <button type="button" onClick={() => setConfirm(null)}>{t("app.chat.threads.keep")}</button>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => onOpen(thread.id)} aria-current={activeId === thread.id ? 'page' : undefined}
                  className={`block w-full truncate rounded-xl px-3 py-2.5 ${folders && folders.length ? 'pe-36' : 'pe-24'} text-start text-sm hover:bg-vx-border/50 ${activeId === thread.id ? 'bg-vx-border/50 font-semibold' : 'text-vx-fg-body'}`}>
                  {thread.pinned ? <span aria-label={t("app.chat.threads.pinned")} className="me-1 text-vx-fg-muted">◆</span> : null}{thread.title}
                </button>
                <span className="absolute end-1 top-1/2 flex -translate-y-1/2 gap-0.5 text-xs opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                  <button type="button" className="rounded-sm px-1.5 py-1 hover:bg-vx-base" aria-label={t(thread.pinned ? 'app.chat.threads.unpinLabel' : 'app.chat.threads.pinLabel', { name: thread.title })} onClick={() => onPatch(thread.id, { pinned: !thread.pinned })}>{thread.pinned ? t("app.chat.threads.unpin") : t("app.chat.threads.pin")}</button>
                  {folders && folders.length > 0 && <button type="button" className="rounded-sm px-1.5 py-1 hover:bg-vx-base" aria-label={t('app.chat.threads.moveTo', { name: thread.title })} onClick={() => setMoving(thread.id)}>{t("app.chat.threads.move")}</button>}
                  <button type="button" className="rounded-sm px-1.5 py-1 hover:bg-vx-base" aria-label={t('app.chat.threads.rename', { name: thread.title })} onClick={() => { setRenaming(thread.id); setDraft(thread.title); }}>{t("app.projects.rename")}</button>
                  <button type="button" className="rounded-sm px-1.5 py-1 hover:bg-vx-base" aria-label={t('app.chat.threads.delete', { name: thread.title })} onClick={() => setConfirm(thread.id)}>{t("app.publish.composer.delete")}</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
