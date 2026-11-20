import { useEffect, useRef } from 'react';
import { nativeWigTask, type Wig3dJob } from '../../lib/liveEdit/wig3dNative';
import { getOverlay, overlayKey, putOverlay } from '../../lib/liveEdit/wig';

/** No native view. Debounce slider changes, then do bounded batches outside React
 * render. Cleanup cancels both pending and partially rendered jobs. Each effect
 * owns its inputs and generator; an obsolete job can never publish a result.
 */
export function NativeWig3d({ job, onChange }: { job: Wig3dJob; onChange(): void }) {
    const latest = useRef(job), notify = useRef(onChange);
    useEffect(() => { latest.current = job; notify.current = onChange; });
    const key = overlayKey(job.wig, job.landmarks, job.width, job.height);
    useEffect(() => {
        if (getOverlay(key)) return;
        const input = latest.current;
        const task = nativeWigTask({ ...input, wig: { ...input.wig }, landmarks: input.landmarks.slice() });
        let cancelled = false;
        const tick = () => {
            if (cancelled) return;
            try {
                const deadline = performance.now() + 8;
                do {
                    const next = task.next();
                    if (next.done) { putOverlay(key, next.value); notify.current(); return; }
                } while (!cancelled && performance.now() < deadline);
                timer = setTimeout(tick, 0);
            } catch {
                task.return({ status: 'unavailable', image: null, fade: 1 });
                if (!cancelled) { putOverlay(key, { status: 'unavailable' }); notify.current(); }
            }
        };
        let timer = setTimeout(tick, 120);
        return () => { cancelled = true; clearTimeout(timer); task.return({ status: 'unavailable', image: null, fade: 1 }); };
    }, [key]);
    return null;
}
