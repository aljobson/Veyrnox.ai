'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { SUPPORT_EMAIL } from '../_lib/tokens';
import { clearAttribution } from '../_lib/utm';
import { applyStoredTheme } from './ThemeToggle';
import ReferralBridge from './ReferralBridge';
import { Icon } from './Icon';

// Everything that floats over every page: the read-progress bar, the
// back-to-top button, the contact button, and the one-time storage notice.
// Mounted once from app/layout.js so it also covers /app/* and /legal/*.
//
// Each piece is `data-print="hide"` — none of it means anything on paper.

const NOTICE_KEY = 'veyrnox_storage_notice';
// Bumped when the notice gains an item (2026-10: the referral code), so visitors who dismissed the old wording see the new one once.
const NOTICE_ACK = 'ack-2026-10-referral';
const TOP_AT = 700; // px scrolled before the back-to-top button earns its place

const never = () => () => {};
const noticeUnread = () => {
  try {
    return localStorage.getItem(NOTICE_KEY) !== NOTICE_ACK;
  } catch {
    // Storage blocked — nothing is being stored, so nothing to disclose.
    return false;
  }
};
const noticeOnServer = () => false;

export default function SiteChrome({ analyticsEnabled = false }) {
  const unread = useSyncExternalStore(never, noticeUnread, noticeOnServer);
  const [acked, setAcked] = useState(false);
  // The analytics consent panel includes the necessary-storage wording. Keep
  // this older notice only while PostHog is not configured, so visitors never
  // receive two overlapping or contradictory privacy notices.
  const noticeOpen = !analyticsEnabled && unread && !acked;

  // Retire unused campaign storage, including records left by older clients.
  useEffect(() => {
    clearAttribution();
  }, []);

  // Mounted from app/layout.js, so the remembered theme reaches /app/* and
  // /legal/* too — not just the routes whose nav happens to show a toggle.
  useEffect(() => {
    applyStoredTheme();
  }, []);

  const ackNotice = useCallback(() => {
    setAcked(true);
    try {
      localStorage.setItem(NOTICE_KEY, NOTICE_ACK);
    } catch {}
  }, []);

  return (
    <>
      <ScrollProgress />
      <ReferralBridge />
      <FloatingActions />
      {noticeOpen && (
        <div data-print="hide" className="fixed inset-x-0 bottom-0 z-50">
          <StorageNotice onDismiss={ackNotice} />
        </div>
      )}
    </>
  );
}

/* ─── Read-progress bar ───
   Decoration: it reports where the page is scrolled to, not the progress of
   a task, so it is hidden from assistive tech instead of being a
   progressbar whose value was rewritten on every frame. */
function ScrollProgress() {
  const barRef = useRef(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    let frame = 0;

    const paint = () => {
      frame = 0;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      // A page shorter than the viewport has no progress to report.
      const ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
      bar.style.transform = `scaleX(${ratio})`;
    };

    const onScroll = () => {
      // One paint per frame — a scroll handler that writes style on every
      // event is the classic way to make a long page feel broken.
      if (!frame) frame = requestAnimationFrame(paint);
    };

    paint();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div
      ref={barRef}
      data-print="hide"
      className="vx-progress"
      aria-hidden="true"
      style={{ transform: 'scaleX(0)' }}
    />
  );
}

/* ─── Back to top + contact, upper-right utility rail ─── */
function FloatingActions() {
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > TOP_AT);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const toTop = useCallback(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    // Send focus somewhere sensible rather than leaving it on a button that
    // is about to disappear.
    document.getElementById('main')?.focus?.({ preventScroll: true });
  }, []);

  return (
    <div
      data-print="hide"
      data-site-actions
      className="fixed right-2 top-[9.75rem] z-50 flex flex-col items-center gap-2"
    >
      {/* `invisible` as well as transparent: a see-through button still
          took a Tab stop at the top of every page. */}
      <button
        type="button"
        onClick={toTop}
        aria-label="Back to top"
        className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-vx-border bg-vx-panel text-vx-fg-body shadow-lg transition-[opacity,visibility] duration-200 hover:border-vx-accent hover:text-vx-fg ${
          showTop ? 'pointer-events-auto visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        <Icon name="arrowUp" size={18} />
      </button>
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        aria-label="Contact support by email"
        title="Contact support"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-vx-accent text-sm font-extrabold text-vx-accent-ink shadow-lg hover:bg-vx-accent-hover"
      >
        <Icon name="mail" />
      </a>
    </div>
  );
}

/* ─── Browser-storage notice ───
   Used only when optional analytics is not configured. When it is configured,
   PostHogManager owns the combined storage and consent notice instead. */
function StorageNotice({ onDismiss }) {
  return (
    <div
      role="region"
      aria-label="Browser storage notice"
      className="vx-slide-up pointer-events-auto w-full border-t border-vx-border bg-vx-panel/95 px-4 py-3 backdrop-blur-sm sm:px-6"
    >
      <div className="mx-auto flex max-w-[1100px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-[1.55] text-vx-fg-body">
          Veyrnox keeps your sign-in session, recent job display history and your theme choice in this browser&rsquo;s local
          storage, plus a friend&rsquo;s referral code for up to three days if you arrived through their link. No advertising cookies, no third-party trackers.{' '}
          <Link href="/legal/privacy" className="text-vx-accent underline underline-offset-4">
            Privacy Policy
          </Link>
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 self-start rounded-full bg-vx-accent px-5 py-2 text-[13px] font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover sm:self-auto"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
