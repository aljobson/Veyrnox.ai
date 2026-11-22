import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { BeatDoc } from './doc';
import { beatStore } from './store';
import { configureNativeTakeStorage } from './takeShared';
import { latencyStorage } from './latencyStore';
import { createTakeRecording, type RecordingDeps } from './takeRecording';
import { registerRecordingFinalizer } from './recordingFinalizers';
import { reconcileBeatTakes } from './takeShared';

// Listen for every successful durable save, even after the editor that recorded it unmounts.
let listening = false;
function setup() {
    configureNativeTakeStorage();
    if (!listening) { beatStore.onPersisted((_id, doc) => reconcileBeatTakes(doc)); listening = true; }
}
export function useTakeRecording(id: string, doc: BeatDoc | undefined, deps: Omit<RecordingDeps, 'storage'>,
    options: { lifecycle?: 'self' | 'editor' } = {}) {
    const controller = useMemo(() => createTakeRecording({ ...deps, saved: () => beatStore.getPersistedBeat(id), storage: latencyStorage() }), [id, deps.current, deps.audio, deps.edit, deps.t]);
    const view = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
    useEffect(() => {
        controller.activate(); setup();
        void latencyStorage().hydrate().catch(() => undefined);
        const unregister = options.lifecycle === 'editor'
            ? () => undefined
            : registerRecordingFinalizer(id, controller.beforeReplace);
        const sub = options.lifecycle === 'editor' ? null : AppState.addEventListener('change', state => {
            if (state === 'background') void controller.finishAndDisarm().then(() => beatStore.flushBeat(id)).catch(() => undefined);
        });
        return () => {
            unregister(); sub?.remove();
            if (options.lifecycle !== 'editor') void controller.dispose().then(() => beatStore.flushBeat(id)).catch(() => undefined);
        };
    }, [id, controller, options.lifecycle]);
    const present = !!doc;
    useEffect(() => { if (present) void controller.refreshRecovery(beatStore.getPersistedBeat(id)); }, [controller, id, present]);
    useEffect(() => {
        if (view.armedId && !doc?.tracks.some(t => t.id === view.armedId)) void controller.finishAndDisarm();
    }, [doc, view.armedId, controller]);
    return { controller, view };
}
