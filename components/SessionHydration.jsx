'use client';

import { useEffect } from 'react';
import { getFreshAccessToken } from '../app/lib/authClient.js';

// Display metadata survives reloads; access credentials are restored only
// into memory. getFreshAccessToken shares concurrent calls, including the
// development StrictMode effect replay and initial account API requests.
export default function SessionHydration() {
  useEffect(() => {
    // A callback owns its one-time code/token exchange. Restoring the old
    // cookie concurrently could invalidate that exchange's session epoch.
    if (window.location.pathname.replace(/\/$/, '') === '/auth/callback') return;
    void getFreshAccessToken().catch(() => {});
  }, []);
  return null;
}
