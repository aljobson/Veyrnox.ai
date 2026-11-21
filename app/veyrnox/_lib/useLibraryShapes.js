'use client';
import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from './gateway';
import { kindOfRow, filterRows } from './libraryFilter';
import { validDimension } from '../../../lib/videoShape.mjs';

// One request at a time, once per visible id per mount/account. Empty and failed reads never loop.
export function useLibraryShapes(rows, visible, actor, models, filters) {
  const [snapshot, setSnapshot] = useState({ actor, items: {} });
  const measured = snapshot.actor === actor ? snapshot.items : {};
  const [, wake] = useState(0);
  const run = useRef(null);
  useEffect(() => {
    const state = { actor, tried: new Set(), busy: false, stopped: false, live: true };
    run.current = state;
    return () => { state.live = false; };
  }, [actor]);
  useEffect(() => {
    const state = run.current;
    if (!actor || !state?.live || state.actor !== actor || state.busy || state.stopped) return;
    const ids = filterRows(rows.slice(0, visible), { ...filters, shape: 'all' }, models).filter(row => row.state === 'succeeded' && !row.held && !row.shape_ambiguous
      && row.has_asset !== false && kindOfRow(row, models) === 'video' && !row.video_width && !measured[row.job_id]
      && (!row.asset_expires_at || Date.parse(row.asset_expires_at) > Date.now()) && !state.tried.has(row.job_id)).slice(0, 12).map(row => row.job_id);
    if (!ids.length) return;
    ids.forEach(id => state.tried.add(id));
    state.busy = true;
    gatewayFetch('/jobs/shapes', { method: 'POST', body: JSON.stringify({ job_ids: ids }) }).then(body => {
      if (!state.live) return;
      const patches = {};
      for (const shape of body.shapes ?? []) if (ids.includes(shape.job_id) && validDimension(shape.width) && validDimension(shape.height))
        patches[shape.job_id] = { video_width: shape.width, video_height: shape.height };
      setSnapshot(prev => ({ actor, items: { ...(prev.actor === actor ? prev.items : {}), ...patches } }));
    }).catch(() => { state.stopped = true; }).finally(() => { state.busy = false; if (state.live) wake(n => n + 1); });
  });
  return rows.map(row => row.held || row.shape_ambiguous ? row : { ...row, ...measured[row.job_id] });
}
