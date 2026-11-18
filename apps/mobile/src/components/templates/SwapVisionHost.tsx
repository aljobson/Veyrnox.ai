import { useEffect, useSyncExternalStore } from 'react';
import { detection } from '../../lib/templateSwap/detection';
import { createSwapVisionJob } from '../../lib/liveEdit/swapProtocol';
import { VisionBridgeTransport } from '../liveEdit/VisionBridge';
export function SwapVisionHost() {
    const job = useSyncExternalStore(detection.subscribe, detection.snapshot);
    useEffect(() => () => { detection.snapshot()?.reject(Error('cutout_failed')); }, []);
    return job ? <VisionBridgeTransport key={job.key} createJob={createSwapVisionJob} frame={job.frame} onResult={job.resolve} onError={() => job.reject(Error('cutout_failed'))} /> : null;
}
