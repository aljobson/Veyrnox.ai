import { useEffect, useMemo, useState } from 'react';
import { decodeTimelineWaveform, waveformClipInputs } from '../../lib/editorTimelineWaveform';
import type { Timeline } from '../../lib/nativeEditorModel';

export function useEditorTimelineWaveforms(projectId: string, timeline: Timeline, localMediaUris: Readonly<Record<string, string>>) {
    const stableInputs = useMemo(() => waveformClipInputs(timeline, localMediaUris), [timeline, localMediaUris]);
    const [waveforms, setWaveforms] = useState<Record<string, number[]>>({});
    useEffect(() => {
        const controller = new AbortController();
        void (async () => {
            for (const { clip, uri } of stableInputs) {
                const peaks = await decodeTimelineWaveform(projectId, uri, clip, timeline.fps, controller.signal);
                if (controller.signal.aborted) return;
                if (peaks.length) setWaveforms(current => ({ ...current, [clip.id]: peaks }));
            }
        })();
        return () => controller.abort();
    }, [projectId, stableInputs, timeline.fps]);
    return waveforms;
}
