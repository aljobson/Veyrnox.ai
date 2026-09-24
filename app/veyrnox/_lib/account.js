/**
 * Who is signed in, from the session already in localStorage — no network.
 * Google sign-ins carry a name in user_metadata; email sign-ups only have the
 * address. The session's `user` can be null after a refresh, so fall back to
 * the email claim in the access token itself, and then to `fallbackEmail`
 * (AppNav passes the one /api/v1/account verified server-side).
 * @param {object|null} session
 * @param {string} [fallbackEmail]
 * @returns {{ name: string, email: string, initial: string } | null}
 */
export function accountLabel(session, fallbackEmail = '') {
  if (!session) return null;
  const meta = session.user?.user_metadata || {};
  let email = session.user?.email || '';
  if (!email && session.access_token) {
    try {
      const b64 = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      email = JSON.parse(atob(b64)).email || '';
    } catch {
      email = '';
    }
  }
  if (!email) email = fallbackEmail || '';
  const name = String(meta.full_name || meta.name || email.split('@')[0] || 'Account').trim();
  return { name, email, initial: (name[0] || '?').toUpperCase() };
}

// Log in / Sign up in the marketing top nav. Both open the AuthGate
// modal via the veyrnox:auth-required event (see components/AuthGate.jsx).
// Sign up preselects the sign-up tab. Signed-in users get an account menu
// (who they are, links into the app, Sign out). Sign out revokes the Supabase
// session server-side AND clears localStorage.
