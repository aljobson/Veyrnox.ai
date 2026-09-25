'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getSession, onSessionChange, signOut } from '../../lib/authClient';
import { ConfirmDialog } from './ConfirmDialog';
import { accountLabel } from '../_lib/account.js';

const ACCOUNT_LINKS = [
  { href: '/social-cinema', label: 'Social Cinema' },
  { href: '/app', label: 'Open Studio' },
  { href: '/app/library', label: 'Library' },
  { href: '/app/credits', label: 'Credits' },
  { href: '/app/account', label: 'Account & security' },
];

// `account` is optional: pass one (AppNav does, so the email can come from
// /api/v1/account when the stored session carries none). The marketing nav
// passes nothing and reads the session on its own.
export function NavAuthButtons({ account: given }) {
  const [sessionAccount, setSessionAccount] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    setSessionAccount(accountLabel(getSession()));
    return onSessionChange((s) => setSessionAccount(accountLabel(s)));
  }, []);

  const account = given || sessionAccount;

  // Close on Escape or a click anywhere outside the menu.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [menuOpen]);

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

  if (account) {
    return (
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Account: ${account.name}`}
          className="flex items-center gap-2 rounded-full pl-1 pr-1 sm:pr-3 py-1 text-sm font-semibold text-vx-fg-body hover:text-vx-fg hover:bg-vx-fg/[0.05]"
        >
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-vx-accent text-vx-accent-ink font-extrabold">
            {account.initial}
          </span>
          <span className="hidden sm:inline max-w-[12rem] truncate">{account.name}</span>
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 w-60 rounded-xl border border-vx-border bg-vx-panel p-1.5 shadow-2xl z-50"
          >
            <div className="px-3 py-2 border-b border-vx-border mb-1">
              <div className="text-sm font-bold text-vx-fg truncate">{account.name}</div>
              {account.email && account.email !== account.name && (
                <div className="text-xs text-vx-fg-muted truncate">{account.email}</div>
              )}
            </div>
            {ACCOUNT_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="block rounded-lg px-3 py-2 text-sm text-vx-fg-body hover:bg-vx-fg/[0.05] hover:text-vx-fg"
              >
                {l.label}
              </Link>
            ))}
            <button
              type="button"
              role="menuitem"
              onClick={() => { setMenuOpen(false); setConfirming(true); }}
              className="block w-full text-left rounded-lg px-3 py-2 text-sm text-vx-fg-body hover:bg-vx-fg/[0.05] hover:text-vx-fg"
            >
              Sign out
            </button>
          </div>
        )}

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
      </div>
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
