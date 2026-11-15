'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PRESETS } from '../../../../../lib/musicInstruments.js';
import { BEAT_LIMITS, createBeat } from '../../../_lib/music/beat/beatDocument.mjs';
import { rename } from '../../../_lib/music/beat/beatOps.mjs';
import * as store from '../../../_lib/music/beat/beatStore.js';
import { action, button, input, storageWarning } from './beatStyles';

export default function BeatsHome() {
  const router = useRouter();
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
    setRecords(result.records); setCount(result.count); setPersistent(result.persistent); setLoaded(true);
  }, []);
  useEffect(() => {
    refresh();
    const unsubscribe = store.subscribeBeats(refresh);
    return () => { request.current = null; unsubscribe(); };
  }, [refresh]);
  async function makeBeat() {
    setBusy(true);
    let number = 1;
    while (records.some((r) => r.doc.title === `Untitled beat ${number}`)) number++;
    const doc = createBeat({ id: crypto.randomUUID(), title: `Untitled beat ${number}` });
    const result = await store.createBeat(doc);
    if (result.error) { setMessage(result.error === 'limit' ? 'This device has 50 beats. Delete one to make room.' : 'Could not create this beat.'); await refresh(); setBusy(false); }
    else router.push(`/app/music/beats/${doc.id}`);
  }
  async function saveName(event) {
    event.preventDefault(); setBusy(true);
    const result = await store.updateBeat(rename(editing.doc, editing.title.trim()), editing.revision);
    setMessage(result.error ? 'This beat changed or was deleted in another tab. The list has been refreshed.' : 'Saved on this device');
    setEditing(null); await refresh(); setBusy(false);
  }
  async function remove(record) {
    if (!window.confirm(`Delete “${record.doc.title}” from this device?`)) return;
    setBusy(true);
    const result = await store.deleteBeat(record.id, record.revision);
    setMessage(result.error ? 'This beat changed in another tab. Review it before deleting.' : 'Beat deleted');
    await refresh(); setBusy(false);
  }
  return <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="font-vx text-3xl font-black">My beats</h1>
      <button className={action} disabled={!loaded || busy || count >= BEAT_LIMITS.projects} onClick={makeBeat}>New beat</button></header>
    {!persistent && <p className="rounded-xl border border-vx-border bg-vx-panel p-4">{storageWarning}</p>}
    {count >= BEAT_LIMITS.projects && <p>This device has 50 beats. Delete one to make room.</p>}
    {!loaded ? <p aria-busy="true">Loading beats…</p> : records.length === 0 ? <section className="rounded-2xl border border-vx-border bg-vx-panel p-6"><h2 className="text-2xl font-bold">Make your first beat</h2><p className="mt-2 text-vx-fg-muted">Build a drum groove, make it yours, and keep it on this device.</p></section> :
      <ul className="space-y-3">{records.map((record) => <li key={record.id} className="rounded-2xl border border-vx-border bg-vx-panel p-4">
        {editing?.id === record.id ? <form onSubmit={saveName} className="flex flex-wrap gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">Beat title<input autoFocus className={input} maxLength={80} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
          <button className={action} disabled={busy || !editing.title.trim()}>Save name</button><button type="button" className={button} onClick={() => setEditing(null)}>Cancel</button>
        </form> : <h2 className="break-words text-xl font-bold">{record.doc.title}</h2>}
        <p className="my-2 text-sm text-vx-fg-muted">{record.doc.tempo.bpm} BPM · {record.doc.tracks.length === 1 ? PRESETS.drums.find((kit) => kit.id === record.doc.tracks[0].kit)?.label : `${record.doc.tracks.length} drum tracks`} · Last edited {new Date(record.updatedAt).toLocaleString()}</p>
        <div className="flex flex-wrap gap-2"><Link className={`${action} inline-flex items-center`} href={`/app/music/beats/${record.id}`}>Open</Link>
          <button className={button} disabled={busy} onClick={() => setEditing({ ...record, title: record.doc.title })}>Rename</button><button className={button} disabled={busy} onClick={() => remove(record)}>Delete</button></div>
      </li>)}</ul>}
    <p aria-live="polite" className="text-sm text-vx-fg-muted">{message}</p>
  </div>;
}
