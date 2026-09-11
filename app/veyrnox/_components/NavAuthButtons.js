'use client';

// Log in / Sign up in the marketing top nav. Both open the AuthGate
// modal via the veyrnox:auth-required event (see components/AuthGate.jsx).
// Sign up preselects the sign-up tab.
export function NavAuthButtons() {
  function openAuth(mode) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('veyrnox:auth-required', { detail: { mode } }));
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
