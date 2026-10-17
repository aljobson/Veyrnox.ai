const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const MIN_TIMELINE_ZOOM = 0.25;
export const MAX_TIMELINE_ZOOM = 8;

export function formatTimecode(frame, fps = 30) {
    const safe = Math.max(0, Number.isFinite(frame) ? Math.round(frame) : 0);
    const frames = safe % fps;
    const seconds = Math.floor(safe / fps) % 60;
    const minutes = Math.floor(safe / (fps * 60)) % 60;
    const hours = Math.floor(safe / (fps * 60 * 60));
    return [hours, minutes, seconds, frames].map(value => String(value).padStart(2, '0')).join(':');
}

export function parseTimecode(value, fps = 30) {
    if (typeof value !== 'string') return null;
    const parts = value.trim().split(':');
    if (parts.length !== 4 || parts.some(part => !/^\d{1,2}$/.test(part))) return null;
    const [hours, minutes, seconds, frames] = parts.map(Number);
    if (minutes > 59 || seconds > 59 || frames >= fps) return null;
    return ((hours * 60 + minutes) * 60 + seconds) * fps + frames;
}

export function fitTimelineZoom(totalFrames, viewportWidth) {
    const available = Math.max(160, Number(viewportWidth) - 24);
    const frames = Math.max(300, Math.max(0, totalFrames) + 150);
    return clamp(Math.floor((available / frames) * 4) / 4, MIN_TIMELINE_ZOOM, MAX_TIMELINE_ZOOM);
}

export function stepTimelineZoom(current, direction) {
    const delta = direction > 0 ? 0.25 : -0.25;
    return clamp(Math.round((current + delta) * 4) / 4, MIN_TIMELINE_ZOOM, MAX_TIMELINE_ZOOM);
}

/**
 * New zoom after clips were added, or null to leave the zoom alone. Only an added clip that no longer fits the
 * visible timeline triggers it, and it only ever zooms out, so a manual zoom is kept for every other edit.
 */
export function autoFitZoom({ prevClips, nextClips, total, ppf, viewport }) {
    if (nextClips <= prevClips || !(total > 0)) return null;
    const width = Number(viewport) > 0 ? Number(viewport) : 800;
    const fitted = fitTimelineZoom(total, width);
    const available = Math.max(160, width - 24);
    const overflows = (Math.max(0, total) + 150) * ppf > available;
    return overflows && fitted < ppf ? fitted : null;
}
