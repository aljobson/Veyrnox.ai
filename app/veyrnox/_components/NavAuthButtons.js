'use client';

import { useEffect, useState } from 'react';
import { getSession, onSessionChange, signOut } from '../../lib/authClient';
import { ConfirmDialog } from './ConfirmDialog';

// Log in / Sign up in the marketing top nav. Both open the AuthGate
// modal via the veyrnox:auth-required event (see components/AuthGate.jsx).
// Sign up preselects the sign-up tab. Signed-in users get Sign out, which
// revokes the Supabase session server-side AND clears localStorage.
export function NavAuthButtons() {
  const [signedIn, setSignedIn] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setSignedIn(!!getSession());
    return onSessionChange((s) => setSignedIn(!!s));
  }, []);

  function openAuth(mode) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('veyrnox:auth-required', { detail: { mode } }));
  }

  function confirmSignOut() {
    setLeaving(true);
    signOut()
      .then(() => window.location.replace('/'))
      .catch(() => {
        // Revoking upstream failed; the local session is gone either way,
        // so land the visitor on the marketing site rather than a dead nav.
        window.location.replace('/');
      });
  }

  if (signedIn) {
    return (
      <>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-vx-fg-body text-sm font-semibold px-3 py-2 hover:text-vx-fg"
        >
          Sign out
        </button>
        {confirming && (
          // Sign-out revokes the session in Supabase — one misplaced click
          // used to end the session with no way back but signing in again.
          <ConfirmDialog
            title="Sign out?"
            body="This ends your session on this device. Your credits, library and ledger are untouched."
            confirmLabel={leaving ? 'Signing out…' : 'Sign out'}
            onConfirm={confirmSignOut}
            onCancel={() => setConfirming(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => openAuth('sign_in')}
        className="text-vx-fg-body text-sm font-semibold px-2 sm:px-3 py-2 hover:text-vx-fg"
      >
        Log in
      </button>
      <button
        type="button"
        onClick={() => openAuth('sign_up')}
        className="rounded-full bg-vx-accent text-vx-accent-ink text-sm font-bold px-4 sm:px-5 py-2.5 hover:bg-vx-accent-hover"
      >
        Sign up
      </button>
    </>
  );
}
