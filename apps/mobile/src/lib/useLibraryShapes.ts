import { useEffect, useRef, useState } from 'react';
import { ApiError, type ApiClient } from './api';
import type { Job, Kind } from './media';
import { validDimension } from './videoShape';

type Dimensions = { video_width: number; video_height: number };
type Pass = { owner: string | undefined; tried: Set<string>; returned: Set<string>; busy: boolean; stopped: boolean; live: boolean; restart: boolean; retryAt: number };
export function useLibraryShapes(api: ApiClient, jobs: readonly Job[], candidateIds: readonly string[], kinds: ReadonlyMap<string, Kind>, owner: string | undefined, enabled = true, refreshKey = 0): Job[] {
    const [snapshot, setSnapshot] = useState<{ owner: string | undefined; items: Record<string, Dimensions> }>({ owner, items: {} });
    const measured = snapshot.owner === owner ? snapshot.items : {};
    const [, wake] = useState(0);
    const run = useRef<Pass | null>(null);
    useEffect(() => {
        const state: Pass = { owner, tried: new Set(), returned: new Set(), busy: false, stopped: false, live: true, restart: false, retryAt: 0 };
        run.current = state;
        return () => { state.live = false; };
    }, [owner, api]);
    useEffect(() => {
        // A focus/refresh starts one pass. Defer its reset until any old request settles.
        if (enabled && run.current) run.current.restart = true;
    }, [enabled, refreshKey]);
    useEffect(() => {
        const state = run.current;
        if (!enabled || !owner || !state?.live || state.owner !== owner || state.busy) return;
        if (state.restart) {
            state.restart = false;
            state.stopped = false;
            state.tried = new Set(state.returned);
        }
        if (state.stopped) return;
        if (state.retryAt > Date.now()) {
            const timer = setTimeout(() => wake(n => n + 1), state.retryAt - Date.now());
            return () => clearTimeout(timer);
        }
        const ids = jobs.filter(job => candidateIds.includes(job.job_id) && job.state === 'succeeded' && !job.held && !job.shape_ambiguous
            && job.has_asset && (kinds.get(job.model_id) === 'video' || job.output_type === 'editor-render') && !job.video_width && !measured[job.job_id]
            && (!job.asset_expires_at || Date.parse(job.asset_expires_at) > Date.now()) && !state.tried.has(job.job_id)).slice(0, 12).map(job => job.job_id);
        if (!ids.length) return;
        ids.forEach(id => state.tried.add(id));
        state.busy = true;
        api.request<{ shapes: { job_id: string; width: number; height: number }[] }>('/api/v1/jobs/shapes', { method: 'POST', body: JSON.stringify({ job_ids: ids }), headers: { 'Content-Type': 'application/json' } }).then(body => {
            if (!state.live) return;
            const patches: Record<string, Dimensions> = {};
            for (const shape of body.shapes ?? []) if (ids.includes(shape.job_id) && validDimension(shape.width) && validDimension(shape.height)) {
                patches[shape.job_id] = { video_width: shape.width, video_height: shape.height };
                state.returned.add(shape.job_id);
            }
            setSnapshot(prev => ({ owner, items: { ...(prev.owner === owner ? prev.items : {}), ...patches } }));
        }).catch(error => {
            state.stopped = true;
            if (error instanceof ApiError && error.status === 429) state.retryAt = Date.now() + (error.retryAfterSeconds ?? 0) * 1000;
        }).finally(() => { state.busy = false; if (state.live) wake(n => n + 1); });
    });
    return jobs.map(job => job.held || job.shape_ambiguous ? job : { ...job, ...measured[job.job_id] });
}
