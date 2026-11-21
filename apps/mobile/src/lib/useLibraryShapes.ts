import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api';
import type { Job, Kind } from './media';
import { validDimension } from './videoShape';

type Dimensions = { video_width: number; video_height: number };
export function useLibraryShapes(api: ApiClient, jobs: readonly Job[], visibleIds: readonly string[], kinds: ReadonlyMap<string, Kind>, owner: string | undefined, enabled = true): Job[] {
    const [snapshot, setSnapshot] = useState<{ owner: string | undefined; items: Record<string, Dimensions> }>({ owner, items: {} });
    const measured = snapshot.owner === owner ? snapshot.items : {};
    const [, wake] = useState(0);
    const run = useRef<{ owner: string | undefined; tried: Set<string>; busy: boolean; stopped: boolean; live: boolean } | null>(null);
    useEffect(() => {
        const state = { owner, tried: new Set<string>(), busy: false, stopped: false, live: true };
        run.current = state;
        return () => { state.live = false; };
    }, [owner, api]);
    useEffect(() => {
        const state = run.current;
        if (!enabled || !owner || !state?.live || state.owner !== owner || state.busy || state.stopped) return;
        const ids = jobs.filter(job => visibleIds.includes(job.job_id) && job.state === 'succeeded' && !job.held && !job.shape_ambiguous
            && job.has_asset && (kinds.get(job.model_id) === 'video' || job.output_type === 'editor-render') && !job.video_width && !measured[job.job_id]
            && (!job.asset_expires_at || Date.parse(job.asset_expires_at) > Date.now()) && !state.tried.has(job.job_id)).slice(0, 12).map(job => job.job_id);
        if (!ids.length) return;
        ids.forEach(id => state.tried.add(id));
        state.busy = true;
        api.request<{ shapes: { job_id: string; width: number; height: number }[] }>('/api/v1/jobs/shapes', { method: 'POST', body: JSON.stringify({ job_ids: ids }), headers: { 'Content-Type': 'application/json' } }).then(body => {
            if (!state.live) return;
            const patches: Record<string, Dimensions> = {};
            for (const shape of body.shapes ?? []) if (ids.includes(shape.job_id) && validDimension(shape.width) && validDimension(shape.height)) patches[shape.job_id] = { video_width: shape.width, video_height: shape.height };
            setSnapshot(prev => ({ owner, items: { ...(prev.owner === owner ? prev.items : {}), ...patches } }));
        }).catch(() => { state.stopped = true; }).finally(() => { state.busy = false; if (state.live) wake(n => n + 1); });
    });
    return jobs.map(job => job.held || job.shape_ambiguous ? job : { ...job, ...measured[job.job_id] });
}
