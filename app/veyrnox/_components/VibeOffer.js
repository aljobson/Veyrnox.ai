'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { skipVibe } from '../_lib/creatorProfile';

// Explore's invitation to the vibe check, shown only while the person has not chosen and the feature is on.
// "Not now" is a recorded skip, so the card does not come back; Account has the way back in.
export function VibeOffer({ status, onSkipped }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  if (status !== 'none') return null;
  async function later() {
    setBusy(true);
    await skipVibe();
    setBusy(false);
    onSkipped();
  }
  return (
    <section aria-labelledby="vibe-offer-title" className="mb-4 flex flex-col gap-3 rounded-2xl border border-vx-border bg-vx-panel p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 id="vibe-offer-title" className="text-lg font-semibold">{t('app.vibe.banner.title')}</h2>
        <p className="text-vx-fg-body">{t('app.vibe.banner.body')}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link href="/app/vibe" className="vx-press rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-vx-base">{t('app.vibe.banner.start')}</Link>
        <button type="button" disabled={busy} onClick={later} className="vx-press rounded-full border border-vx-border px-5 py-2.5 text-sm font-bold disabled:opacity-50">{t('app.vibe.banner.later')}</button>
      </div>
    </section>
  );
}
