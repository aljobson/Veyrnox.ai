const reasons = {
  autosave: 'Autosave',
  checkpoint: 'Checkpoint',
  conflict: 'Account version kept when you chose Keep mine',
  stash: 'Your changes kept when you chose Load theirs',
};
export const versionReason = reason => reasons[reason] || reason;
export function versionTime(savedAt, now = new Date()) {
  const date = new Date(savedAt);
  const today = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const day = today ? 'Today' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}
