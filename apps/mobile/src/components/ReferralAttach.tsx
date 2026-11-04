import { useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { attachReferral } from '../lib/referrals';
import { attachIsFinal, recallReferral, secureReferralStore } from '../lib/referralCapture';

// Renders nothing. Once the person is signed in, tells the server which friend's code brought them; the server decides whether it counts.
export function ReferralAttach() {
    const { api, status, generation } = useAuth();
    useEffect(() => {
        if (status !== 'signedIn') return;
        const code = recallReferral();
        if (!code) return;
        let live = true;
        attachReferral(api, code)
            .then(() => live && secureReferralStore.remove())
            .catch((err) => { if (live && attachIsFinal(err)) secureReferralStore.remove(); });
        return () => { live = false; };
    }, [api, status, generation]);
    return null;
}
