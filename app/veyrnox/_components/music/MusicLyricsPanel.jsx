'use client';

import { useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { tOr } from '../../../../lib/i18n/translate.mjs';

/** Lyrics as plain text with a copy button (0535). Renders nothing for an instrumental. */
export function MusicLyricsPanel({ lyrics }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('');
  if (typeof lyrics !== 'string' || !lyrics.trim()) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(lyrics);
      setStatus(tOr(t, 'music.lyrics.copied', 'Lyrics copied'));
    } catch {
      setStatus(tOr(t, 'music.lyrics.copyFailed', "Copy didn't work in this browser. Select the lyrics and copy them instead."));
    }
  }

  return (
    <section aria-labelledby="music-lyrics-title" className="mt-6 rounded-2xl border border-vx-border bg-vx-base p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="music-lyrics-title" className="font-vx text-lg font-black">{tOr(t, 'music.lyrics.title', 'Lyrics')}</h2>
        <button type="button" onClick={copy} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold">{tOr(t, 'music.lyrics.copy', 'Copy lyrics')}</button>
      </div>
      <p role="status" className="mt-2 min-h-5 text-xs text-vx-fg-muted">{status}</p>
      <p className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap wrap-break-word text-sm leading-6 text-vx-fg-body">{lyrics}</p>
    </section>
  );
}
