'use client';
import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ANNOUNCEMENT, isDismissed, dismiss } from '../_lib/announcement';

const never = () => () => {};
const dismissedHere = () => Boolean(ANNOUNCEMENT) && isDismissed(window.localStorage, ANNOUNCEMENT.id);
const notDismissed = () => false;

// Rendered on the server so there is no layout jump for a first visit; a
// browser that closed this announcement hides it right after mount.
export function AnnouncementBar() {
  const dismissed = useSyncExternalStore(never, dismissedHere, notDismissed);
  const [closed, setClosed] = useState(false);
  if (!ANNOUNCEMENT || dismissed || closed) return null;
  return (
    <div data-print="hide" role="region" aria-label="Announcement" className="bg-vx-fg text-vx-base">
      <div className="max-w-[1300px] mx-auto px-4 sm:px-6 py-2 flex items-center justify-center gap-3 text-[13px]">
        <span className="min-w-0">{ANNOUNCEMENT.message}</span>
        <Link href={ANNOUNCEMENT.href} className="shrink-0 font-bold underline underline-offset-4">{ANNOUNCEMENT.cta}</Link>
        <button
          type="button"
          aria-label="Dismiss announcement"
          onClick={() => { dismiss(window.localStorage, ANNOUNCEMENT.id); setClosed(true); }}
          className="shrink-0 px-1 text-[16px] leading-none opacity-70 hover:opacity-100"
        >
          ×
        </button>
      </div>
    </div>
  );
}
