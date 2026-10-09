// The site-wide announcement shown above the marketing nav. One at a time.
// Change `id` with the message: a dismissal is remembered per id, so a new
// announcement shows again to people who closed the last one. Set to null
// for no bar.
export const ANNOUNCEMENT = {
  id: '2026-10-tools',
  message: 'New: tools for your own images and video, and ready-made templates.',
  cta: 'See the tools',
  href: '/tools',
};

const KEY = 'veyrnox_announcement_dismissed';

/** True when this browser closed the announcement with this id. */
export function isDismissed(storage, id) {
  try {
    return storage.getItem(KEY) === id;
  } catch {
    return false;
  }
}

/** Remember the dismissal; a blocked store just means it shows again next visit. */
export function dismiss(storage, id) {
  try {
    storage.setItem(KEY, id);
  } catch { /* not remembered */ }
}
