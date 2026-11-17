'use client';
import Link from 'next/link';
import BeatTemplatePicker from './BeatTemplatePicker';
import { useI18n } from '../../../../../components/I18nProvider';
import { createBeatFromTemplate } from '../../../_lib/music/beat/beatTemplates.mjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBeatAccountList } from './useBeatAccountList';
import { trackSummary } from '../../../_lib/music/beat/beatTrackSummary.mjs';
import { BEAT_LIMITS } from '../../../_lib/music/beat/beatDocument.mjs';
import { rename } from '../../../_lib/music/beat/beatOps.mjs';
import * as store from '../../../_lib/music/beat/beatStore.js';
import { action, button, input } from './beatStyles';

export default function BeatsHome({ cloud = false }) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const picker = useRef(null);
  const [readError, setReadError] = useState(false), [damaged, setDamaged] = useState([]);
  const [records, setRecords] = useState([]);
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(null);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const token = {}; request.current = token;
    const result = await store.listBeats();
    if (token !== request.current) return;
    setLoaded(true); setReadError(Boolean(result.error));
    if (result.error) return;
    setDamaged(result.damaged || []);
    setRecords(result.records); setCount(result.count); setPersistent(result.persistent); setLoaded(true);
  }, []);
  const account = useBeatAccountList(cloud, router, setMessage, refresh);
  useEffect(() => {
    refresh();
    const unsubscribe = store.subscribeBeats(refresh);
    return () => { request.current = null; unsubscribe(); };
  }, [refresh]);
  async function makeBeat(template) {
    setBusy(true);
    let number = 1;
    while (records.some((r) => r.doc.title === `Untitled beat ${number}`)) number++;
    const doc = createBeatFromTemplate({ template, id: crypto.randomUUID(), title: `Untitled beat ${number}` });
    const userId = account.userId();
    const result = await store.createBeat(doc, cloud && userId ? { userId, projectId: null, revision: 0, syncedUpdatedAt: 0 } : undefined);
    if (result.error) { picker.current?.close(); setMessage(result.error === 'limit' ? t('app.music.beat.ui.this.device.has.50.beats.delete.one.to.make.room') : t('app.music.beat.status.s61')); await refresh(); setBusy(false); }
    else router.push(`/app/music/beats/${doc.id}`);
  }
  async function saveName(event) {
    event.preventDefault(); setBusy(true);
    const result = await store.updateBeat(rename(editing.doc, editing.title.trim()), editing.revision);
    setMessage(result.error ? t('app.music.beat.status.s62') : t('app.music.beat.ui.saved.on.this.device'));
    setEditing(null); await refresh(); setBusy(false);
  }
  async function remove(record) {
    if (!window.confirm(t('app.music.beat.status.s63', { p0: record.doc.title }))) return;
    setBusy(true);
    const result = await store.deleteBeat(record.id, record.revision);
    setMessage(result.error ? t('app.music.beat.status.s64') : t('app.music.beat.status.s65'));
    await refresh(); setBusy(false);
  }
  return <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="font-vx text-3xl font-black">{t('app.music.beat.ui.my.beats')}</h1>
      <button className={action} disabled={!loaded || readError || busy || count >= BEAT_LIMITS.projects} onClick={() => picker.current.showModal()}>{t('app.music.beat.ui.new.beat')}</button></header>
    <dialog ref={picker} aria-label={t('app.music.beat.templates')} className="m-auto max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-4 text-vx-fg backdrop:bg-vx-base/80">
      <h2 className="text-xl font-bold">{t('app.music.beat.templates')}</h2><BeatTemplatePicker choose={makeBeat} disabled={busy} focusBlank />
      <button className={`${button} mt-4`} onClick={() => picker.current.close()}>{t('app.music.beat.close')}</button>
    </dialog>
    {readError && <p role="alert" className="text-vx-danger">{t('app.music.beat.device.readError')} <button className={button} onClick={refresh}>{t('app.music.beat.ui.retry')}</button></p>}
    {damaged.length > 0 && <ul className="space-y-3">{damaged.map(record => <li key={record.id} className="rounded-xl border border-vx-border p-4">
      <p>{t('app.music.beat.device.damaged')}</p><button className={button} disabled={busy} onClick={async () => {
        if (!window.confirm(t('app.music.beat.device.deleteDamaged'))) return;
        setBusy(true); const result = await store.deleteDamagedBeat(record.id, record.revision);
        if (result.error) setMessage(t('app.music.beat.device.deleteError'));
        await refresh(); setBusy(false);
      }}>{t('app.music.beat.ui.delete')}</button>
    </li>)}</ul>}
    {!persistent && <p className="rounded-xl border border-vx-border bg-vx-panel p-4">{t('app.music.beat.recovery.r11')}</p>}
    {count >= BEAT_LIMITS.projects && <p>{t('app.music.beat.ui.this.device.has.50.beats.delete.one.to.make.room')}</p>}
    {!loaded ? <p aria-busy="true">{t('app.music.beat.ui.loading.beats')}</p> : !readError && count === 0 && account.rows.length === 0 && account.loaded ? <section className="rounded-2xl border border-vx-border bg-vx-panel p-6"><h2 className="text-2xl font-bold">{t('app.music.beat.ui.make.your.first.beat')}</h2><p className="mt-2 text-vx-fg-muted">{t('app.music.beat.ui.build.a.drum.groove.make.it.yours.and.keep.it.on.this.device')}</p><BeatTemplatePicker choose={makeBeat} disabled={busy} /></section> : <ul className="space-y-3">{records.map((record) => <li key={record.id} className="rounded-2xl border border-vx-border bg-vx-panel p-4">
        {editing?.id === record.id ? <form onSubmit={saveName} className="flex flex-wrap gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">{t('app.music.beat.ui.beat.title')}<input autoFocus className={input} maxLength={80} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
          <button className={action} disabled={busy || !editing.title.trim()}>{t('app.music.beat.ui.save.name')}</button><button type="button" className={button} onClick={() => setEditing(null)}>{t('app.music.beat.ui.cancel')}</button>
        </form> : <h2 className="break-words text-xl font-bold">{record.doc.title}</h2>}
        <p className="my-2 text-sm text-vx-fg-muted">{record.doc.tempo.bpm}{t('app.music.beat.ui.bpm.2')}{trackSummary(record.doc.tracks, t, locale)}{t('app.music.beat.ui.last.edited')}{new Date(record.updatedAt).toLocaleString()}</p>
        {cloud && <p className="my-2 text-sm text-vx-fg-muted">{t('app.music.beat.ui.on.this.device')}{account.rows.some(row => row.beat_id === record.id) ? t('app.music.beat.ui.in.your.account') : ''}</p>}
        <div className="flex flex-wrap gap-2"><Link className={`${action} inline-flex items-center`} href={`/app/music/beats/${record.id}`}>{t('app.music.beat.ui.open')}</Link>
          <button className={button} disabled={busy} onClick={() => setEditing({ ...record, title: record.doc.title })}>{t('app.music.beat.ui.rename')}</button><button className={button} disabled={busy} onClick={() => remove(record)}>{t('app.music.beat.ui.delete')}</button>
          {cloud && account.rows.some(row => row.beat_id === record.id) && <button className={button} onClick={() => account.remove(account.rows.find(row => row.beat_id === record.id))}>{t('app.music.beat.ui.remove.from.account')}</button>}</div>
      </li>)}</ul>}
    {cloud && <section aria-label={t('app.music.beat.ui.account.beats')} className="space-y-3">
      {account.message && <p role="status">{account.message} <button className={button} onClick={account.refresh}>{t('app.music.beat.ui.retry')}</button></p>}
      <ul className="space-y-3">{account.rows.filter(row => !records.some(record => record.id === row.beat_id)).map(row => <li key={row.id} className="space-y-3 rounded-2xl border border-vx-border bg-vx-panel p-4">
        <h2 className="text-xl font-bold">{row.title}</h2><p className="text-sm text-vx-fg-muted">{t('app.music.beat.ui.in.your.account.2')}</p>
        <div className="flex flex-wrap gap-2"><button className={action} onClick={() => account.open(row)}>{t('app.music.beat.ui.open')}</button><button className={button} onClick={() => account.remove(row)}>{t('app.music.beat.ui.remove.from.account')}</button></div>
      </li>)}</ul>
    </section>}
    <p aria-live="polite" className="text-sm text-vx-fg-muted">{message}</p>
  </div>;
}
