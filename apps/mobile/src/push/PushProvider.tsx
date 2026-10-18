import type { ReactNode } from 'react';
import { PUSH_ENABLED } from '../lib/push';

// The native notification modules load only when push is switched on for the build, so a
// build (or a development client) without them still starts.
export function PushProvider({ children }: { children: ReactNode }) {
    if (!PUSH_ENABLED) return <>{children}</>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PushProviderLive } = require('./PushProviderLive') as typeof import('./PushProviderLive');
    return <PushProviderLive>{children}</PushProviderLive>;
}
