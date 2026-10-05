'use client';
import { useMemo, useState } from 'react';
import { ALL_CHATS, UNFILED, folderLabel, visibleThreads } from '../../_lib/chatFolders';

const field = 'rounded-lg border bg-vx-base px-3 py-2 text-sm text-vx-fg';

// Search, pin, rename, move and delete. Delete asks first. Pinned chats sort first. Folders group chats: pick one to
// narrow the list; deleting a folder keeps its chats. `folders` is null when folders are not available, and then none of
// the folder controls show.
export function ThreadList({ threads, folders = null, folder = ALL_CHATS, onFolder, onNewFolder, onRenameFolder, onDeleteFolder, onMove, activeId, onOpen, onNew, onPatch, onDelete }) {
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [moving, setMoving] = useState(null);
  const [folderMode, setFolderMode] = useState(null); // null | 'new' | 'rename' | 'delete'
  const [folderDraft, setFolderDraft] = useState('');
  const shown = useMemo(() => visibleThreads(threads, { query, folder }), [threads, query, folder]);
  const unfiled = threads.filter((t) => !t.folder_id).length;
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
    <nav aria-label="Chats" className="flex h-full flex-col gap-2 p-3">
      <button type="button" onClick={onNew} className="rounded-full border border-vx-border px-4 py-2 text-left text-sm font-semibold hover:border-vx-accent">New chat</button>
      <label className="sr-only" htmlFor="chat-search">Search chats</label>
      <input id="chat-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats"
        className={`${field} border-vx-border placeholder:text-vx-fg-faint`} />

      {folders && (
        <div className="space-y-1">
          <label className="sr-only" htmlFor="chat-folder">Folder</label>
          <select id="chat-folder" value={current ? folder : folder === UNFILED ? UNFILED : ALL_CHATS} onChange={(e) => choose(e.target.value)}
            className={`w-full ${field} border-vx-border`}>
            <option value={ALL_CHATS}>{folderLabel(ALL_CHATS, folders, threads.length)}</option>
            <option value={UNFILED}>{folderLabel(UNFILED, folders, unfiled)}</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{folderLabel(f.id, folders, threads.length)}</option>)}
          </select>
          {folderMode === 'new' || folderMode === 'rename' ? (
            <input autoFocus aria-label={folderMode === 'new' ? 'New folder name' : 'Folder name'} maxLength={60} value={folderDraft}
              onChange={(e) => setFolderDraft(e.target.value)} onBlur={commitFolder}
              onKeyDown={(e) => { if (e.key === 'Enter') commitFolder(); if (e.key === 'Escape') setFolderMode(null); }}
              className={`w-full ${field} border-vx-accent`} />
          ) : folderMode === 'delete' && current ? (
            <div role="alert" className="flex items-center gap-3 rounded-lg bg-vx-border/50 px-3 py-2 text-sm">
              <span className="flex-1">Delete this folder? Its chats stay.</span>
              <button type="button" className="font-semibold text-vx-danger" onClick={() => { setFolderMode(null); onDeleteFolder(current.id); }}>Delete</button>
              <button type="button" onClick={() => setFolderMode(null)}>Keep</button>
            </div>
          ) : (
            <div className="flex gap-1 text-xs">
              <button type="button" className="rounded px-2 py-1 hover:bg-vx-border/50" onClick={() => { setFolderDraft(''); setFolderMode('new'); }}>New folder</button>
              {current && <button type="button" className="rounded px-2 py-1 hover:bg-vx-border/50" aria-label={`Rename folder ${current.name}`} onClick={() => { setFolderDraft(current.name); setFolderMode('rename'); }}>Rename</button>}
              {current && <button type="button" className="rounded px-2 py-1 hover:bg-vx-border/50" aria-label={`Delete folder ${current.name}`} onClick={() => setFolderMode('delete')}>Delete</button>}
            </div>
          )}
        </div>
      )}

      <ul className="mt-1 flex-1 space-y-1 overflow-y-auto">
        {threads.length === 0 && <li className="px-2 py-3 text-sm text-vx-fg-muted">Nothing here yet. Start a chat and it will appear in this list.</li>}
        {threads.length > 0 && shown.length === 0 && (
          <li className="px-2 py-3 text-sm text-vx-fg-muted">
            {query.trim() ? 'No chats match that search.' : folder === UNFILED ? 'Every chat is in a folder.' : 'No chats in this folder yet. Move one here from its Move button.'}
          </li>
        )}
        {shown.map((t) => (
          <li key={t.id} className="group relative">
            {renaming === t.id ? (
              <input autoFocus aria-label="Chat name" maxLength={120} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(t.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(t.id); if (e.key === 'Escape') setRenaming(null); }}
                className={`w-full ${field} border-vx-accent`} />
            ) : moving === t.id && folders ? (
              <select autoFocus aria-label={`Move ${t.title} to a folder`} value={t.folder_id || ''} onBlur={() => setMoving(null)}
                onKeyDown={(e) => { if (e.key === 'Escape') setMoving(null); }}
                onChange={(e) => { const to = e.target.value || null; setMoving(null); onMove(t.id, to); }}
                className={`w-full ${field} border-vx-accent`}>
                <option value="">No folder</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            ) : confirm === t.id ? (
              <div role="alert" className="flex items-center gap-3 rounded-lg bg-vx-border/50 px-3 py-2 text-sm">
                <span className="flex-1">Delete this chat?</span>
                <button type="button" className="font-semibold text-vx-danger" onClick={() => { setConfirm(null); onDelete(t.id); }}>Delete</button>
                <button type="button" onClick={() => setConfirm(null)}>Keep</button>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => onOpen(t.id)} aria-current={activeId === t.id ? 'page' : undefined}
                  className={`block w-full truncate rounded-lg px-3 py-2 ${folders && folders.length ? 'pr-36' : 'pr-24'} text-left text-sm hover:bg-vx-border/50 ${activeId === t.id ? 'bg-vx-border/50 font-semibold' : 'text-vx-fg-body'}`}>
                  {t.pinned ? <span aria-label="Pinned" className="mr-1 text-vx-fg-muted">◆</span> : null}{t.title}
                </button>
                <span className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5 text-xs opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                  <button type="button" className="rounded px-1.5 py-1 hover:bg-vx-base" aria-label={`${t.pinned ? 'Unpin' : 'Pin'} ${t.title}`} onClick={() => onPatch(t.id, { pinned: !t.pinned })}>{t.pinned ? 'Unpin' : 'Pin'}</button>
                  {folders && folders.length > 0 && <button type="button" className="rounded px-1.5 py-1 hover:bg-vx-base" aria-label={`Move ${t.title} to a folder`} onClick={() => setMoving(t.id)}>Move</button>}
                  <button type="button" className="rounded px-1.5 py-1 hover:bg-vx-base" aria-label={`Rename ${t.title}`} onClick={() => { setRenaming(t.id); setDraft(t.title); }}>Rename</button>
                  <button type="button" className="rounded px-1.5 py-1 hover:bg-vx-base" aria-label={`Delete ${t.title}`} onClick={() => setConfirm(t.id)}>Delete</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
