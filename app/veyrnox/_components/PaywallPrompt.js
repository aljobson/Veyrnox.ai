'use client';
import { useI18n } from '../../../components/I18nProvider';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Modal } from './Modal';
import { Button } from './Button';
import { TopUpPacks } from './TopUpPacks';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { paywallReason } from '../_lib/paywallPrompt.mjs';

const seenKey = (id) => `veyrnox_paywall_seen_${id}`;
const sessionKey = (id) => `veyrnox_paywall_session_${id}`;

// Storage can throw (private windows, blocked site data); a failed read means
// "not seen", a failed write means the prompt may repeat. Neither blocks the page.
function read(store, key) {
  try { return window[store].getItem(key) === '1'; } catch { return false; }
}
function write(store, key, on) {
  try { on ? window[store].setItem(key, '1') : window[store].removeItem(key); } catch {}
}


// Puts the credit packs in front of a signed-in account: once for a new
// account, and once per sign-in while the balance is low. It never blocks
// use of the app, and never grants anything (TopUpPacks starts Stripe checkout).
export function PaywallPrompt({ credits, createdAt }) {
  const { t } = useI18n();
  const COPY = {
    first: { title: t("app.credits.paywall.firstTitle"), body: t("app.credits.paywall.firstBody") },
    low: { title: t("app.credits.paywall.lowTitle"), body: t("app.credits.paywall.lowBody") },
  };

  const pathname = usePathname();
  const [reason, setReason] = useState(null);

  // Signing out ends the sign-in, so the next one is prompted again.
  useEffect(() => onSessionChange((s) => {
    if (s) return;
    const id = getStoredUserId();
    if (id) write('sessionStorage', sessionKey(id), false);
  }), []);

  useEffect(() => {
    const id = getStoredUserId();
    // /app/credits already is the paywall.
    if (!id || pathname?.startsWith('/app/credits')) return;
    const next = paywallReason({
      credits,
      createdAt,
      seenFirst: read('localStorage', seenKey(id)),
      shownThisSession: read('sessionStorage', sessionKey(id)),
    });
    if (!next) return;
    write('sessionStorage', sessionKey(id), true);
    if (next === 'first') write('localStorage', seenKey(id), true);
    setReason(next);
  }, [credits, createdAt, pathname]);

  if (!reason) return null;
  const { title, body } = COPY[reason];
  return (
    <Modal onCancel={() => setReason(null)} aria-labelledby="paywall-title" className="items-center justify-center p-4">
      <div className="max-h-full w-full max-w-[1040px] overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-6 sm:p-8">
        <h2 id="paywall-title" className="vx-display text-[28px]">{title}</h2>
        <p className="mt-2 text-vx-fg-body">{body}</p>
        <TopUpPacks signedIn />
        <div className="mt-5">
          <Button variant="ghost" onClick={() => setReason(null)}>{t("app.credits.paywall.later")}</Button>
        </div>
      </div>
    </Modal>
  );
}
