// The tool tabs of the Photo Studio panel. Pure, so the keyboard behaviour can be tested without a browser.
export const TABS = ['adjust', 'makeup', 'hair', 'stickers'];
/** The tab a key moves to (arrows wrap, Home and End jump), or null when the key does nothing. */
export function nextTab(current, key) {
    const at = Math.max(0, TABS.indexOf(current));
    if (key === 'ArrowRight') return TABS[(at + 1) % TABS.length];
    if (key === 'ArrowLeft') return TABS[(at + TABS.length - 1) % TABS.length];
    if (key === 'Home') return TABS[0];
    if (key === 'End') return TABS[TABS.length - 1];
    return null;
}
