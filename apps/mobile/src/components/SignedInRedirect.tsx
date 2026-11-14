import { Redirect, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { forgetPendingLink, recallPendingLink } from '../lib/pendingLink';

export const SIGNED_IN_HOME = '/(app)/(tabs)';

// Where a person goes once signed in: the destination of the link that brought them to sign-in, when one was kept
// and is still valid (pendingLink.ts), otherwise the tabs. The destination is read once and removed as it is used.
export function SignedInRedirect() {
    const [href] = useState<string>(() => recallPendingLink() ?? SIGNED_IN_HOME);
    useEffect(() => { forgetPendingLink(); }, []);
    return <Redirect href={href as Href} />;
}
