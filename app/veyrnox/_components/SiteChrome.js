'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SUPPORT_EMAIL } from '../_lib/tokens';
import { clearAttribution } from '../_lib/utm';
import { applyStoredTheme } from './ThemeToggle';

// Everything that floats over every page: the read-progress bar, the
// back-to-top button, the contact button, and the one-time storage notice.
// Mounted once from app/layout.js so it also covers /app/* and /legal/*.
//
// Each piece is `data-print="hide"` — none of it means anything on paper.

const NOTICE_KEY = 'veyrnox_storage_notice';
const TOP_AT = 700; // px scrolled before the back-to-top button earns its place

export default function SiteChrome() {
  const [noticeOpen, setNoticeOpen] = useState(false);

  // Retire unused campaign storage, including records left by older clients.
  useEffect(() => {
    clearAttribution();
  }, []);

  // Mounted from app/layout.js, so the remembered theme reaches /app/* and
  // /legal/* too — not just the routes whose nav happens to show a toggle.
  useEffect(() => {
    applyStoredTheme();
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem(NOTICE_KEY) !== 'ack') setNoticeOpen(true);
    } catch {
      // Storage blocked — nothing is being stored, so nothing to disclose.
    }
  }, []);

  const ackNotice = useCallback(() => {
    setNoticeOpen(false);
    try {
      localStorage.setItem(NOTICE_KEY, 'ack');
    } catch {}
  }, []);

  return (
    <>
      <ScrollProgress />
      {/* The buttons ride above the notice while it is up, instead of
          sitting under it in the same bottom-right corner. */}
      <FloatingActions raised={noticeOpen} />
      {noticeOpen && <StorageNotice onDismiss={ackNotice} />}
    </>
  );
}

/* ─── Read-progress bar ─── */
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
      bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
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
      role="progressbar"
      aria-label="Page scroll progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      style={{ transform: 'scaleX(0)' }}
    />
  );
}

/* ─── Back to top + contact, bottom-right ─── */
function FloatingActions({ raised = false }) {
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
    document.getElementById('main')?.focus?.();
  }, []);

  return (
    <div
      data-print="hide"
      className={`fixed right-4 z-50 flex flex-col items-end gap-2 transition-[bottom] sm:right-6 ${
        raised ? 'bottom-36 sm:bottom-24' : 'bottom-4 sm:bottom-6'
      }`}
    >
      <button
        type="button"
        onClick={toTop}
        aria-label="Back to top"
        className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-vx-border bg-vx-panel text-vx-fg-body shadow-lg transition-opacity hover:border-vx-accent hover:text-vx-fg ${
          showTop ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <span aria-hidden="true" className="text-base leading-none">↑</span>
      </button>
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-vx-accent px-4 text-sm font-extrabold text-vx-accent-ink shadow-lg hover:bg-vx-accent-hover"
      >
        <span aria-hidden="true">✉</span>
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
      data-print="hide"
      role="region"
      aria-label="Browser storage notice"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-vx-border bg-vx-panel/95 px-4 py-3 backdrop-blur sm:px-6"
    >
      <div className="mx-auto flex max-w-[1100px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-[1.55] text-vx-fg-body">
          Veyrnox keeps your sign-in session, recent job display history and your theme choice in this browser&rsquo;s local
          storage. No advertising cookies, no third-party trackers.{' '}
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
