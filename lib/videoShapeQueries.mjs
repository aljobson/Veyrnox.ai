import { itemShape } from './videoShape.mjs';

// The list is newest first. Walk only until the newest measured finished video is found.
export async function newestMeasuredVideo(request, current = () => true) {
    let path = '/api/v1/jobs?limit=50';
    const seen = new Set();
    while (current()) {
        const page = await request(path);
        if (!current()) return null;
        const found = page.jobs?.find(job => job.state === 'succeeded' && !job.held && job.has_asset && !job.shape_ambiguous
            && (!job.asset_expires_at || Date.parse(job.asset_expires_at) > Date.now()) && itemShape(job));
        if (found) return found;
        // Old Workers omit all shape fields. Do not page through the whole history during rollout.
        if (!page.jobs?.some(job => 'shape_ambiguous' in job || 'video_width' in job)) return null;
        if (!page.next) return null;
        path = `/api/v1/jobs?limit=50&before=${encodeURIComponent(page.next.before)}&before_id=${encodeURIComponent(page.next.before_id)}`;
        if (seen.has(path)) return null;
        seen.add(path);
    }
    return null;
}
export async function measureFinishedVideo(request, id) {
    const result = await request('/api/v1/jobs/shapes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_ids: [id] }) });
    const shape = result.shapes?.find(shape => shape.job_id === id);
    if (shape && itemShape(shape)) return shape;
    // A replay is write-once and returns no newly measured rows. Read its stored value.
    const page = await request('/api/v1/jobs?limit=50');
    return page.jobs?.find(job => job.job_id === id && job.state === 'succeeded' && !job.held && job.has_asset && itemShape(job)) ?? null;
}
