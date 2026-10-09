// Calendar uses the viewer's local timezone, matching the composer.
export const POST_STATUSES = ['scheduled', 'published', 'failed', 'canceled'];
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function instant(value) {
    return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(`${value.slice(0,10)}T00:00:00Z`).toISOString().slice(0,10) === value.slice(0,10);
}
export function dateKey(value) {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function localInput(value) {
    const d = new Date(value);
    return `${dateKey(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
export function localSchedule(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null;
    const d = new Date(value);
    return Number.isFinite(d.getTime()) && localInput(d) === value ? d.toISOString() : null;
}
export function calendarWindow(anchor, view) {
    const d = new Date(`${anchor}T12:00:00`);
    const start = new Date(d.getFullYear(), d.getMonth(), view === 'week' ? d.getDate() : 1);
    start.setDate(start.getDate() - (start.getDay()+6)%7);
    const length = view === 'week' ? 7 : 42;
    const days = Array.from({length}, (_,i) => {const day=new Date(start);day.setDate(day.getDate()+i);return dateKey(day);});
    const end = new Date(start);end.setDate(end.getDate()+length);
    return { from:start.toISOString(),to:end.toISOString(),days };
}
export function shiftCalendar(anchor, view, direction) {
    const d = new Date(`${anchor}T12:00:00`);
    if (view === 'week') d.setDate(d.getDate()+direction*7);
    else { d.setDate(1);d.setMonth(d.getMonth()+direction); }
    return dateKey(d);
}
export function droppedSchedule(post, day) {
    return `${day}T${localInput(post.scheduled_at).slice(11)}`;
}
