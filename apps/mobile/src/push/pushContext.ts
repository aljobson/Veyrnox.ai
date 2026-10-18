import { createContext, useContext } from 'react';

// Light on purpose: no native modules, so Account can read it in a build that has push off.

export type EnableResult = 'on' | 'off' | 'denied' | 'unavailable';

export interface PushValue {
    // True when this build and device can use push at all (shows the switch in Account).
    readonly supported: boolean;
    readonly enabled: boolean;
    setEnabled(on: boolean): Promise<EnableResult>;
    // Best effort, before sign-out revokes the session.
    unregister(): Promise<void>;
}

export const PushContext = createContext<PushValue>({
    supported: false, enabled: false, setEnabled: async () => 'unavailable', unregister: async () => {},
});

export const usePush = () => useContext(PushContext);

