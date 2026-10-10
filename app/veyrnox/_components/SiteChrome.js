'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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

export default function SiteChrome() {
  const unread = useSyncExternalStore(never, noticeUnread, noticeOnServer);
  const [acked, setAcked] = useState(false);
  const noticeOpen = unread && !acked;
  // The chat composer sits at the bottom edge, so the buttons ride above it there.
  const onChat = (usePathname() || '').startsWith('/app/chat');

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
      {/* One bottom stack: the buttons sit on top of the notice whatever
          height it wraps to. A fixed offset stopped clearing it on a phone
          once the notice grew a sentence, and the Contact button slid half
          under it. The stack itself takes no clicks; its children do. */}
      <div data-print="hide" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-end">
        <FloatingActions raised={onChat && !noticeOpen} tucked={noticeOpen} />
        {noticeOpen && <StorageNotice onDismiss={ackNotice} />}
      </div>
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

/* ─── Back to top + contact, bottom-right ───
   `raised` lifts them clear of the chat composer. `tucked` drops Back to
   top on a phone while the storage notice is up, which already takes a
   fifth of the screen there. Contact stays: on most pages it is the only
   contact link. */
function FloatingActions({ raised = false, tucked = false }) {
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
      className={`mr-4 flex flex-col items-end gap-2 sm:mr-6 ${
        raised ? 'mb-36 sm:mb-24' : 'mb-4 sm:mb-6'
      }`}
    >
      {/* `invisible` as well as transparent: a see-through button still
          took a Tab stop at the top of every page. */}
      <button
        type="button"
        onClick={toTop}
        aria-label="Back to top"
        className={`${tucked ? 'hidden sm:inline-flex' : 'inline-flex'} h-11 w-11 items-center justify-center rounded-full border border-vx-border bg-vx-panel text-vx-fg-body shadow-lg transition-[opacity,visibility] duration-200 hover:border-vx-accent hover:text-vx-fg ${
          showTop ? 'pointer-events-auto visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        <Icon name="arrowUp" size={18} />
      </button>
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full bg-vx-accent px-4 text-sm font-extrabold text-vx-accent-ink shadow-lg hover:bg-vx-accent-hover"
      >
        <Icon name="mail" />
        <span className="hidden sm:inline">Contact</span>
        <span className="sr-only sm:hidden">Contact support by email</span>
      </a>
    </div>
  );
}

/* ─── Browser-storage notice ───
   Veyrnox sets no advertising or analytics cookies — the session and a
   couple of preferences live in localStorage, which is exempt from consent
   as strictly necessary. So this tells the truth and offers a dismiss; it
   does not pretend to gate consent it does not need. */
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
