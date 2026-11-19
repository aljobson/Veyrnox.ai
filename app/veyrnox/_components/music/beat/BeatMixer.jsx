'use client';
import { useI18n } from '../../../../../components/I18nProvider';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import BeatChannelStrip from './BeatChannelStrip';
import BeatMasterStrip from './BeatMasterStrip';
import { button } from './beatStyles';
const query = '(max-width: 767px)';
const subscribe = callback => { const media = matchMedia(query); media.addEventListener('change', callback); return () => media.removeEventListener('change', callback); };
export default function BeatMixer({ doc, edit, engine, close, onAutomation, recording = false }) {
  const { t } = useI18n();
  const mobile = useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => false), dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    return () => previous?.focus();
  }, []);
  useEffect(() => { const sheet = dialog.current; if (mobile && sheet && !sheet.open) sheet.showModal(); return () => sheet?.close(); }, [mobile]);
  const contents = <>
    <div className="flex items-center justify-between gap-3 p-3"><h2 id="beat-mixer-title" className="text-xl font-bold">{t('app.music.beat.ui.mixer')}</h2><button data-beat-read data-beat-live className={button} onClick={close}>{t('app.music.beat.ui.close.mixer')}</button></div>
    <div role="region" aria-label={t('app.music.beat.ui.mixer.channels')} tabIndex={0} className="flex min-w-0 max-w-full items-start gap-3 overflow-x-auto p-3 focus-visible:outline-vx-accent">
      {doc.tracks.map(track => <BeatChannelStrip key={track.id} doc={doc} track={track} recording={recording} edit={edit} engine={engine}
        onAutomation={(id, lane) => { onAutomation(id, lane); if (mobile) close(); }} />)}
      <BeatMasterStrip doc={doc} edit={edit} engine={engine} />
    </div>
  </>;
  return mobile ? <dialog ref={dialog} aria-labelledby="beat-mixer-title" onCancel={e => { e.preventDefault(); close(); }}
    className="fixed inset-0 m-0 h-dvh max-h-dvh w-full max-w-full overflow-y-auto bg-vx-base text-vx-fg backdrop:bg-vx-base/80">{contents}</dialog>
    : <section aria-labelledby="beat-mixer-title" className="min-w-0 max-w-full rounded-xl border border-vx-border bg-vx-base">{contents}</section>;
}
