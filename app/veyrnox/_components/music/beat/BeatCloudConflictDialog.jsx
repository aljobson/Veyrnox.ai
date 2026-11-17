'use client';
import { useI18n } from '../../../../../components/I18nProvider';

import { useEffect, useRef } from 'react';
import { action, button } from './beatStyles';
export default function BeatCloudConflictDialog({ sync }) {
  const { t } = useI18n();
  const dialog = useRef(null), open = Boolean(sync.conflict);
  useEffect(() => { if (open) dialog.current.showModal(); else dialog.current.close(); }, [open]);
  return <dialog ref={dialog} aria-labelledby="beat-conflict-title" onCancel={() => sync.later()}
    className="m-auto w-full max-w-lg space-y-4 rounded-2xl border border-vx-border bg-vx-panel p-6 text-vx-fg backdrop:bg-vx-base/80">
    <h2 id="beat-conflict-title" className="text-xl font-bold">{t('app.music.beat.ui.choose.which.beat.to.keep.open')}</h2>
    <p>{t('app.music.beat.ui.the.account.version.changed.the.other.version.will.be.saved.in.version')}</p>
    {sync.detail && <p role="alert">{sync.detail}</p>}
    <div className="flex flex-wrap gap-3">
      <button className={`${action} min-h-11`} disabled={sync.busy} onClick={() => sync.resolve('mine')}>{t('app.music.beat.ui.keep.mine')}</button>
      <button className={`${button} min-h-11`} disabled={sync.busy} onClick={() => sync.resolve('theirs')}>{t('app.music.beat.ui.load.theirs')}</button>
    </div>
    {sync.busy && <p role="status">{t('app.music.beat.ui.saving.your.changes.and.takes.to.your.account')}</p>}
    <p className="text-sm text-vx-fg-muted">{t('app.music.beat.ui.press.escape.to.decide.later.your.beat.stays.on.this.device')}</p>
  </dialog>;
}
