// Which chats the list shows, for a search and a folder choice. Pure, so it is tested without a browser.

export const ALL_CHATS = 'all';
export const UNFILED = 'unfiled';

/** The chats to show: in the chosen folder, matching the search, pinned first then newest. The input is not changed. */
export function visibleThreads(threads, { query = '', folder = ALL_CHATS } = {}) {
  const q = String(query).trim().toLowerCase();
  return threads
    .filter((t) => folder === ALL_CHATS || (folder === UNFILED ? !t.folder_id : t.folder_id === folder))
    .filter((t) => !q || t.title.toLowerCase().includes(q))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updated_at).localeCompare(String(a.updated_at)));
}

/** The text of a folder choice, with the number of chats in it. A folder that no longer exists reads as all chats. */
export function folderLabel(folder, folders, total) {
  if (folder === UNFILED) return `Unfiled (${total})`;
  const f = folders.find((x) => x.id === folder);
  return f ? `${f.name} (${f.count})` : `All chats (${total})`;
}
