'use client';
import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider';
import { MUSIC_STUDIO_HREF, showSpeechSongNudge } from '../_lib/speechSongNudge.mjs';

/**
 * Shown under a prompt box when a speech model is selected and the text reads like a song.
 * It only points at Music; it never changes the model or the prompt.
 */
export function SpeechSongNudge({ model, prompt, className = '' }) {
  const { t } = useI18n();
  if (!showSpeechSongNudge(model, prompt)) return null;
  return (
    <p role="note" data-testid="speech-song-nudge" className={`text-xs leading-5 text-vx-fg-muted ${className}`}>
      {t('app.audio.songNudge.text')}{' '}
      <Link href={MUSIC_STUDIO_HREF} className="font-bold text-vx-accent underline underline-offset-2">{t('app.audio.songNudge.action')}</Link>
    </p>
  );
}
