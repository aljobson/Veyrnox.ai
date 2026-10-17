'use client';
import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ANNOUNCEMENT, isDismissed, dismiss } from '../_lib/announcement';
import { useI18n } from '../../../components/I18nProvider';

const never = () => () => {};
const dismissedHere = () => Boolean(ANNOUNCEMENT) && isDismissed(window.localStorage, ANNOUNCEMENT.id);
const notDismissed = () => false;

// Rendered on the server so there is no layout jump for a first visit; a
// browser that closed this announcement hides it right after mount.
export function AnnouncementBar() {
  const dismissed = useSyncExternalStore(never, dismissedHere, notDismissed);
  const [closed, setClosed] = useState(false);
  const { t, href } = useI18n();
  if (!ANNOUNCEMENT || dismissed || closed) return null;
  return (
    <div data-print="hide" role="region" aria-label={t('announce.label')} className="bg-vx-fg text-vx-base">
      <div className="max-w-[1300px] mx-auto px-4 sm:px-6 py-2 flex items-center justify-center gap-3 text-[13px]">
        <span className="min-w-0">{t('announce.message')}</span>
        <Link href={href(ANNOUNCEMENT.href)} className="shrink-0 font-bold underline underline-offset-4 focus-visible:outline-vx-base">{t('announce.cta')}</Link>
        {/* 40px to press; the negative margins keep the bar its own height.
            Focus rings here take the base colour: the site's teal ring all
            but vanishes on a bar that is the foreground colour. */}
        <button
          type="button"
          aria-label={t('announce.dismiss')}
          onClick={() => { dismiss(window.localStorage, ANNOUNCEMENT.id); setClosed(true); }}
          className="-my-2.5 -mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[16px] leading-none opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-vx-base"
        >
          ×
        </button>
      </div>
    </div>
  );
}
