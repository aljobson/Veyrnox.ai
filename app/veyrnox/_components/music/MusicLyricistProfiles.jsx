'use client';

import { useState } from 'react';
import { chatApi, chatErrorCopy } from '../../_lib/chatApi';
import {
  buildMusicLyricistProfile, isMusicLyricistProfile, musicLyricistLabel,
  MUSIC_LYRICIST_DIRECTION_MAX, MUSIC_LYRICIST_EXAMPLES_MAX, MUSIC_LYRICIST_NAME_MAX,
} from './musicLyricist';

const blank = { name: '', direction: '', examples: '', ownsExamples: false };

export function MusicLyricistProfiles({ selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [form, setForm] = useState(blank);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function reveal() {
    setOpen((value) => !value);
    if (loaded) return;
    setBusy(true); setError('');
    try {
      const result = await chatApi.personas();
      setEnabled(Boolean(result?.enabled));
      setProfiles((result?.personas || []).filter(isMusicLyricistProfile));
      setLoaded(true);
    } catch (reason) {
      setError(chatErrorCopy(reason?.code));
    } finally { setBusy(false); }
  }

  async function create() {
    const body = buildMusicLyricistProfile(form);
    if (!body) return;
    setBusy(true); setError('');
    try {
      const result = await chatApi.savePersona(body);
      setProfiles((items) => [...items, result.persona].sort((a, b) => a.name.localeCompare(b.name)));
      onSelect(result.persona.id);
      setForm(blank);
      setCreating(false);
    } catch (reason) { setError(chatErrorCopy(reason?.code)); } finally { setBusy(false); }
  }

  async function remove(profile) {
    setBusy(true); setError('');
    try {
      await chatApi.removePersona(profile.id);
      setProfiles((items) => items.filter((item) => item.id !== profile.id));
      if (selectedId === profile.id) onSelect('');
      setRemoving(null);
    } catch (reason) { setError(chatErrorCopy(reason?.code)); } finally { setBusy(false); }
  }

  const body = buildMusicLyricistProfile(form);
  return (
    <section aria-label="Lyricist profiles" className="rounded-2xl border border-vx-border bg-vx-base p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-bold">Private Lyricist profiles</h3><p className="mt-1 text-xs leading-5 text-vx-fg-muted">Reuse broad craft traits from examples you wrote or own. Profiles are private Chat instructions—not trained voice or style models.</p></div>
        <button type="button" onClick={reveal} aria-expanded={open} className="min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold">{open ? 'Hide profiles' : 'Choose or create'}</button>
      </div>
      {open ? (
        <div className="mt-4 space-y-4">
          {busy && !loaded ? <p role="status" className="text-sm text-vx-fg-muted">Loading private profiles…</p> : null}
          {error ? <p role="alert" className="text-sm text-vx-danger">{error}</p> : null}
          {loaded && !enabled ? <p className="text-sm text-vx-fg-muted">Private Chat profiles are not enabled for this account. Lyric editing still works without one.</p> : null}
          {loaded && enabled ? (
            <>
              <label className="block text-sm font-bold">Profile for the next Chat
                <select value={selectedId} onChange={(event) => onSelect(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 font-normal text-vx-fg">
                  <option value="">No Lyricist profile</option>
                  {profiles.map((profile) => <option key={profile.id} value={profile.id}>{musicLyricistLabel(profile)}</option>)}
                </select>
              </label>
              <ul className="space-y-2" aria-label="Saved Lyricist profiles">
                {profiles.map((profile) => <li key={profile.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-vx-border px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate font-bold">{musicLyricistLabel(profile)}</span>{removing?.id === profile.id ? <><button type="button" disabled={busy} onClick={() => remove(profile)} className="rounded-full border border-vx-danger px-3 py-1 font-bold text-vx-danger">Confirm delete</button><button type="button" onClick={() => setRemoving(null)} className="rounded-full border border-vx-border px-3 py-1">Keep</button></> : <button type="button" onClick={() => setRemoving(profile)} className="rounded-full border border-vx-border px-3 py-1">Delete</button>}</li>)}
              </ul>
              {!creating ? <button type="button" onClick={() => setCreating(true)} className="min-h-10 rounded-full border border-vx-accent px-4 text-sm font-bold">New Lyricist profile</button> : (
                <div className="space-y-3 rounded-xl border border-vx-border bg-vx-panel p-3">
                  <label className="block text-sm font-bold">Profile name<input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} maxLength={MUSIC_LYRICIST_NAME_MAX} className="mt-1 min-h-10 w-full rounded-lg border border-vx-border bg-vx-base px-3 font-normal" /></label>
                  <label className="block text-sm font-bold">Broad writing direction<textarea value={form.direction} onChange={(event) => setForm((value) => ({ ...value, direction: event.target.value }))} maxLength={MUSIC_LYRICIST_DIRECTION_MAX} rows={3} placeholder="Concrete coastal imagery, short internal rhymes, restrained language" className="mt-1 w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 font-normal" /></label>
                  <label className="block text-sm font-bold">Examples you wrote or own<textarea value={form.examples} onChange={(event) => setForm((value) => ({ ...value, examples: event.target.value }))} maxLength={MUSIC_LYRICIST_EXAMPLES_MAX} rows={6} placeholder="Paste a few private examples" className="mt-1 w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 font-vx-mono text-sm font-normal" /></label>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.ownsExamples} onChange={(event) => setForm((value) => ({ ...value, ownsExamples: event.target.checked }))} className="mt-1 h-4 w-4 accent-vx-accent" /><span>I wrote or own these examples and allow Veyrnox to save them privately as Chat instructions.</span></label>
                  <div className="flex gap-2"><button type="button" onClick={create} disabled={!body || busy} className="min-h-10 rounded-full bg-vx-accent px-4 text-sm font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Saving…' : 'Save profile'}</button><button type="button" onClick={() => { setCreating(false); setForm(blank); }} className="min-h-10 rounded-full border border-vx-border px-4 text-sm">Cancel</button></div>
                </div>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
