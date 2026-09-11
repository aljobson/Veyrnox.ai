'use client';

import { useEffect, useState } from 'react';
import { getSession, onSessionChange, signOut } from '../../lib/authClient';

// Log in / Sign up in the marketing top nav. Both open the AuthGate
// modal via the veyrnox:auth-required event (see components/AuthGate.jsx).
// Sign up preselects the sign-up tab. Signed-in users get Sign out, which
// revokes the Supabase session server-side AND clears localStorage.
export function NavAuthButtons() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    setSignedIn(!!getSession());
    return onSessionChange((s) => setSignedIn(!!s));
  }, []);

  function openAuth(mode) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('veyrnox:auth-required', { detail: { mode } }));
  }

  if (signedIn) {
    return (
      <button
        type="button"
        onClick={() => { signOut().then(() => window.location.replace('/')); }}
        className="text-vx-fg-body text-sm font-semibold px-3 py-2 hover:text-vx-fg"
      >
        Sign out
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => openAuth('sign_in')}
        className="text-vx-fg-body text-sm font-semibold px-3 py-2 hover:text-vx-fg"
      >
        Log in
      </button>
      <button
        type="button"
        onClick={() => openAuth('sign_up')}
        className="rounded-full bg-vx-accent text-vx-accent-ink text-sm font-bold px-5 py-2.5 hover:bg-vx-accent-hover"
      >
        Sign up
      </button>
    </>
  );
}
