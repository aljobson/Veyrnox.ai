'use client';
import { useMemo, useState } from 'react';

// Search, pin, rename and delete. Delete asks first. Pinned chats sort first.
export function ThreadList({ threads, activeId, onOpen, onNew, onPatch, onDelete }) {
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((t) => !q || t.title.toLowerCase().includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updated_at).localeCompare(String(a.updated_at)));
  }, [threads, query]);
  const commit = (id) => { const title = draft.trim(); setRenaming(null); if (title) onPatch(id, { title }); };

  return (
    <nav aria-label="Chats" className="flex h-full flex-col gap-2 p-3">
      <button type="button" onClick={onNew} className="rounded-full border border-vx-border px-4 py-2 text-left text-sm font-semibold hover:border-vx-accent">New chat</button>
      <label className="sr-only" htmlFor="chat-search">Search chats</label>
      <input id="chat-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats"
        className="rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-sm text-vx-fg placeholder:text-vx-fg-faint" />
      <ul className="mt-1 flex-1 space-y-1 overflow-y-auto">
        {threads.length === 0 && <li className="px-2 py-3 text-sm text-vx-fg-muted">Nothing here yet. Start a chat and it will appear in this list.</li>}
        {threads.length > 0 && shown.length === 0 && <li className="px-2 py-3 text-sm text-vx-fg-muted">No chats match that search.</li>}
        {shown.map((t) => (
          <li key={t.id} className="group relative">
            {renaming === t.id ? (
              <input autoFocus aria-label="Chat name" maxLength={120} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(t.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(t.id); if (e.key === 'Escape') setRenaming(null); }}
                className="w-full rounded-lg border border-vx-accent bg-vx-base px-3 py-2 text-sm text-vx-fg" />
            ) : confirm === t.id ? (
              <div role="alert" className="flex items-center gap-3 rounded-lg bg-vx-border/50 px-3 py-2 text-sm">
                <span className="flex-1">Delete this chat?</span>
                <button type="button" className="font-semibold text-vx-danger" onClick={() => { setConfirm(null); onDelete(t.id); }}>Delete</button>
                <button type="button" onClick={() => setConfirm(null)}>Keep</button>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => onOpen(t.id)} aria-current={activeId === t.id ? 'page' : undefined}
                  className={`block w-full truncate rounded-lg px-3 py-2 pr-24 text-left text-sm hover:bg-vx-border/50 ${activeId === t.id ? 'bg-vx-border/50 font-semibold' : 'text-vx-fg-body'}`}>
                  {t.pinned ? <span aria-label="Pinned" className="mr-1 text-vx-fg-muted">◆</span> : null}{t.title}
                </button>
                <span className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5 text-xs opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                  <button type="button" className="rounded px-1.5 py-1 hover:bg-vx-base" aria-label={`${t.pinned ? 'Unpin' : 'Pin'} ${t.title}`} onClick={() => onPatch(t.id, { pinned: !t.pinned })}>{t.pinned ? 'Unpin' : 'Pin'}</button>
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
