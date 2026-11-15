'use client';

import { useRef, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { getStoredUserId } from '../../../lib/authClient';
import { gatewayFetch } from '../../_lib/gateway';
import { MUSIC_COMMENT_REPORT_CATEGORIES } from '../../../../lib/musicComments.js';

/**
 * Report a public track (0533). Shown only when the public read says reports
 * are open. The creator cannot report their own song (the server refuses it).
 */
export function MusicTrackReport({ slug }) {
  const { t } = useI18n();
  const signedIn = Boolean(getStoredUserId());
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const attempt = useRef(null);

  async function send(event) {
    event.preventDefault();
    const text = details.trim();
    if (busy || text.length < 3) return;
    const signature = `${category}:${text}`;
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: `song-report.${crypto.randomUUID()}` };
    setBusy(true); setError('');
    try {
      await gatewayFetch('/music/comments', { method: 'POST', body: JSON.stringify({ action: 'report_song', slug, category, details: text, idempotency_key: attempt.current.key }) });
      setNotice(t('music.track.reported')); setOpen(false); setDetails(''); attempt.current = null;
    } catch (e) {
      setError(e?.status === 429 ? t('music.track.reportSlowDown') : t('music.track.reportFailed'));
    } finally { setBusy(false); }
  }

  if (notice) return <p role="status" className="mt-6 text-sm text-vx-fg-muted">{notice}</p>;
  if (!signedIn) return <p className="mt-6 text-xs text-vx-fg-faint">{t('music.track.reportSignIn')}</p>;
  return (
    <div className="mt-6">
      {!open ? (
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className="min-h-11 text-sm text-vx-fg-muted underline underline-offset-4">{t('music.track.report')}</button>
      ) : (
        <form onSubmit={send} aria-label={t('music.track.report')} className="space-y-3 rounded-2xl border border-vx-border bg-vx-base p-4">
          <label className="block text-sm font-bold">{t('music.track.reportReason')}
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="ml-2 min-h-11 rounded-xl bg-vx-panel-raised px-2 font-normal">
              {MUSIC_COMMENT_REPORT_CATEGORIES.map((k) => <option key={k} value={k}>{t(`music.comments.category.${k}`)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-bold">{t('music.track.reportDetails')}
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} minLength={3} maxLength={500} rows={3} className="mt-2 w-full rounded-xl bg-vx-panel-raised p-3 font-normal" />
          </label>
          {error ? <p role="alert" className="text-sm text-vx-danger">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy || details.trim().length < 3} className="min-h-11 rounded-full bg-vx-accent px-5 text-sm font-bold text-vx-accent-ink disabled:opacity-40">{t('music.track.sendReport')}</button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-full border border-vx-border px-5 text-sm font-bold">{t('music.track.reportCancel')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
