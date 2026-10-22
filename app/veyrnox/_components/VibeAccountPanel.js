'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { resetVibe, useVibe } from '../_lib/creatorProfile';

// Account's way back into the vibe check: retake it, or clear it. Hidden while the feature is off.
export function VibeAccountPanel() {
  const { t } = useI18n();
  const vibe = useVibe();
  const [note, setNote] = useState('');
  if (vibe.status === 'loading' || vibe.status === 'unavailable') return null;
  async function reset() {
    setNote('');
    const r = await resetVibe();
    if (!r.ok && r.code !== 'unavailable') { setNote(t('app.vibe.error')); return; }
    await vibe.reload();
    setNote(t('app.vibe.account.resetDone'));
  }
  const button = 'vx-press rounded-full border border-vx-border px-4 py-2 text-sm font-bold';
  return (
    <section aria-labelledby="vibe-account-title" className="mb-8 rounded-2xl border border-vx-border bg-vx-panel p-5">
      <h2 id="vibe-account-title" className="text-lg font-semibold">{t('app.vibe.account.title')}</h2>
      <p className="mt-1 text-vx-fg-body">{t(`app.vibe.account.status.${vibe.status}`)} {t('app.vibe.account.retakeHint')}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/app/vibe?retake=1" className={button}>{t('app.vibe.account.retake')}</Link>
        <button type="button" onClick={reset} className={button}>{t('app.vibe.account.reset')}</button>
      </div>
      {note ? <p role="status" className="mt-3 text-sm text-vx-fg-muted">{note}</p> : null}
    </section>
  );
}
