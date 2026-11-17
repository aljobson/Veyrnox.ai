'use client';
import { useEffect, useRef } from 'react';
import { useI18n } from '../../../../../components/I18nProvider';
import { BEAT_SHORTCUTS, shortcutKeys } from '../../../_lib/music/beat/beatShortcuts.mjs';
import { button } from './beatStyles';
export default function BeatShortcutSheet({ open, close, replayTips }) {
  const { t } = useI18n();
  const dialog = useRef(null), opener = useRef(null), replayPending = useRef(false);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const element = dialog.current; element.showModal();
    return () => { element.close(); if (opener.current?.isConnected) opener.current.focus(); };
  }, [open]);
  useEffect(() => {
    if (open || !replayPending.current) return;
    replayPending.current = false;
    replayTips();
  }, [open, replayTips]);
  return <dialog ref={dialog} onClose={close} aria-labelledby="beat-shortcuts-title" className="m-auto max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-4 text-vx-fg backdrop:bg-vx-base/80">
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-vx-panel py-2"><h2 id="beat-shortcuts-title" className="text-xl font-bold">{t('app.music.beat.shortcuts')}</h2><button autoFocus className={button} onClick={() => dialog.current.close()}>{t('app.music.beat.close')}</button></div>
    <p className="my-3 text-sm">{t('app.music.beat.shortcut.scope')}</p>
    {[...new Set(BEAT_SHORTCUTS.map(row => row.context))].map(context => <section key={context} className="my-4">
      <h3 className="font-bold">{t(`app.music.beat.shortcut.context.${context}`)}</h3>
      <dl>{BEAT_SHORTCUTS.filter(row => row.context === context).map(row => <div key={row.id} className="space-y-1 border-b border-vx-border py-3">
        <dt className="break-words font-mono text-sm" dir="ltr">{shortcutKeys(row, typeof navigator === 'undefined' ? {} : navigator, t)}</dt><dd>{row.controlKeys.map(key => t(key)).join(' / ')}</dd>
      </div>)}</dl>
    </section>)}
    <button className={button} onClick={() => { replayPending.current = true; dialog.current.close(); }}>{t('app.music.beat.tips.replay')}</button>
  </dialog>;
}
