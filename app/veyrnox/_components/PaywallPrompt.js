'use client';
import { useI18n } from '../../../components/I18nProvider';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Modal } from './Modal';
import { Button } from './Button';
import { TopUpPacks } from './TopUpPacks';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { paywallReason } from '../_lib/paywallPrompt.mjs';

const seenKey = (id) => `veyrnox_paywall_seen_${id}`;
const sessionKey = (id) => `veyrnox_paywall_session_${id}`;
const depletedKey = (id) => `veyrnox_paywall_depleted_${id}`;
const subscribeClientReady = () => () => {};
const clientReady = () => true;
const serverNotReady = () => false;

// Storage can throw (private windows, blocked site data); a failed read means
// "not seen", a failed write means the prompt may repeat. Neither blocks the page.
function read(store, key) {
  try { return window[store].getItem(key) === '1'; } catch { return false; }
}
function write(store, key, on) {
  try { on ? window[store].setItem(key, '1') : window[store].removeItem(key); } catch {}
}


// Puts the credit packs in front of a signed-in account: once for a new
// account, once per sign-in while the balance is low, and once for each zero
// balance cycle. It never blocks use of the app, and never grants anything
// (TopUpPacks starts Stripe checkout).
export function PaywallPrompt({ credits, createdAt }) {
  const pathname = usePathname();
  const ready = useSyncExternalStore(subscribeClientReady, clientReady, serverNotReady);
  const [, setStorageRevision] = useState(0);
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false);
  const accountId = ready ? getStoredUserId() : null;
  const reason = (() => {
    if (!ready || !accountId || pathname?.startsWith('/app/credits')) return null;
    return paywallReason({
      credits,
      createdAt,
      seenFirst: read('localStorage', seenKey(accountId)),
      shownThisSession: read('sessionStorage', sessionKey(accountId)),
      shownDepletedBalance: read('sessionStorage', depletedKey(accountId)),
    });
  })();

  // Signing out ends the sign-in, so the next one is prompted again.
  useEffect(() => onSessionChange((s) => {
    if (s) return;
    const id = getStoredUserId();
    if (id) write('sessionStorage', sessionKey(id), false);
  }), []);

  useEffect(() => {
    if (!accountId || pathname?.startsWith('/app/credits') || !Number.isFinite(credits)) return;
    // A positive balance starts a new depletion cycle. Do this before the
    // once-per-session rule so the next genuine run-out can prompt again.
    if (credits > 0) write('sessionStorage', depletedKey(accountId), false);
    if (!reason) return;
    if (reason === 'depleted') write('sessionStorage', depletedKey(accountId), true);
    else write('sessionStorage', sessionKey(accountId), true);
    if (reason === 'first') write('localStorage', seenKey(accountId), true);
  }, [accountId, credits, pathname, reason]);

  // The public projection carries no account or provider identifiers. Only
  // advertise recurring checkout when the server says the catalog is open;
  // production stays quiet while its approval gate is closed.
  useEffect(() => {
    if (!reason) return;
    const controller = new AbortController();
    fetch('/api/credit-subscription-plans', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((catalog) => {
        if (!controller.signal.aborted) setSubscriptionsOpen(Array.isArray(catalog?.plans) && catalog.plans.length > 0);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [reason]);

  if (!reason) return null;
  const close = () => setStorageRevision((revision) => revision + 1);
  return <PaywallOffer reason={reason} subscriptionsOpen={subscriptionsOpen} onClose={close} />;
}

// Kept separate from the storage orchestration so every customer-visible
// state has a deterministic rendering baseline.
export function PaywallOffer({ reason, subscriptionsOpen = false, onClose }) {
  const { t } = useI18n();
  const COPY = {
    first: { title: t("app.credits.paywall.firstTitle"), body: t("app.credits.paywall.firstBody") },
    low: { title: t("app.credits.paywall.lowTitle"), body: t("app.credits.paywall.lowBody") },
    depleted: { title: t("app.credits.paywall.emptyTitle"), body: t("app.credits.paywall.emptyBody") },
  };
  const { title, body } = COPY[reason];
  return (
    <Modal onCancel={onClose} aria-labelledby="paywall-title" className="items-center justify-center p-4">
      <div className="max-h-full w-full max-w-[1040px] overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-6 sm:p-8">
        <h2 id="paywall-title" className="vx-display text-[28px]">{title}</h2>
        <p className="mt-2 text-vx-fg-body">{body}</p>
        <p className="mt-2 text-sm text-vx-fg-muted">{t("app.credits.paywall.repeat")}</p>
        {subscriptionsOpen && (
          <Link href="/app/credits#credit-subscriptions" onClick={onClose} className="mt-4 inline-flex rounded-full border border-vx-accent px-4 py-2 text-sm font-bold text-vx-accent hover:bg-vx-accent/[0.08]">
            {t("app.credits.paywall.subscriptions")}
          </Link>
        )}
        <TopUpPacks signedIn welcome={reason === 'low' ? 'welcomeLow' : 'welcomeFirst'} />
        <div className="mt-5">
          <Button variant="ghost" onClick={onClose}>{t("app.credits.paywall.later")}</Button>
        </div>
      </div>
    </Modal>
  );
}
