import { beatText, beatEnglish } from './beatDisplay.mjs';
const reasons = {
  autosave: 'Autosave',
  checkpoint: 'Checkpoint',
  conflict: 'Earlier account version (kept before your save replaced it)',
  stash: 'Your changes kept when you chose Load theirs',
};
export const versionReason = (reason, t = beatEnglish) => beatText(reasons[reason] || reason, t);
export function versionTime(savedAt, now = new Date(), t = beatEnglish, locale) {
  const date = new Date(savedAt);
  const today = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const day = today ? t('app.music.beat.shared.today') : date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = date.toLocaleTimeString(locale || 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}
