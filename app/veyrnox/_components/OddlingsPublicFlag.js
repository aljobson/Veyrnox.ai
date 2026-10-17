'use client';

import { createContext, useContext } from 'react';

const OddlingsPublicFlag = createContext(false);

// ODDLINGS_PUBLIC_ENABLED, read per request in the shared layout. The nav and
// search use it to link the public gallery only while that gallery is open.
export function OddlingsPublicFlagProvider({ enabled, children }) {
    return <OddlingsPublicFlag.Provider value={enabled === true}>{children}</OddlingsPublicFlag.Provider>;
}

export function useOddlingsPublic() {
    return useContext(OddlingsPublicFlag);
}
