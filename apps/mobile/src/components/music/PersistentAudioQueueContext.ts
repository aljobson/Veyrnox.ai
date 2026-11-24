import { createContext, useContext } from 'react';
import type { OwnedQueueEntry, PersistentQueueCapability, PublicQueueEntry } from '../../lib/music/persistentAudioQueue';

export type PersistentAudioQueueApi = {
    publicEnabled: boolean;
    ownedEnabled: boolean;
    capability: PersistentQueueCapability;
    addPublic(entry: Omit<PublicQueueEntry, 'type'>): void;
    addOwned(entry: Omit<OwnedQueueEntry, 'type'>): void;
};

export const PersistentAudioQueueContext = createContext<PersistentAudioQueueApi | null>(null);

export function usePersistentAudioQueue(): PersistentAudioQueueApi | null {
    return useContext(PersistentAudioQueueContext);
}
