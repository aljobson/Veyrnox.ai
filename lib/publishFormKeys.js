// Enter in a single-line field of the Publish composer triggers the browser's implicit submission, which clicks the
// form's first submit button. That button is "Post now", so Enter in the schedule field would publish at once.
// The three buttons are the only way to submit.
const SINGLE_LINE_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week', '']);

export function blocksImplicitSubmit(event) {
    if (!event || event.key !== 'Enter' || event.isComposing) return false;
    const target = event.target;
    if (!target || String(target.tagName).toUpperCase() !== 'INPUT') return false;
    return SINGLE_LINE_TYPES.has(String(target.type || '').toLowerCase());
}
