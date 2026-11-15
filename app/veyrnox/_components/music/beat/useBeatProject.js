'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as store from '../../../_lib/music/beat/beatStore.js';

export function useBeatProject(id, announce) {
  const [doc, setDoc] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [persistent, setPersistent] = useState(true);
  const [conflict, setConflict] = useState(null);
  const current = useRef(null);
  const revision = useRef(0);
  const blocked = useRef(null);
  const saving = useRef(false);
  const generation = useRef(0);
  const markConflict = useCallback((kind) => {
    blocked.current = kind; setConflict(kind);
    announce(kind === 'deleted' ? 'This beat was deleted in another tab' : 'This beat was changed in another tab');
  }, [announce]);
  const reload = useCallback(async () => {
    const token = {}; generation.current = token;
    const result = await store.getBeat(id);
    if (token !== generation.current) return;
    setPersistent(result.persistent !== false);
    if (!result.record) {
      if (current.current && result.error === 'not_found') markConflict('deleted');
      else setError(result.error);
      return;
    }
    revision.current = result.record.revision; current.current = result.record.doc; blocked.current = null;
    setDoc(result.record.doc); setSaved(result.record.doc); setConflict(null); setError('');
  }, [id, markConflict]);
  useEffect(() => {
    let mounted = true;
    Promise.resolve().then(() => { if (mounted) reload(); });
    const unsubscribe = store.subscribeBeats((message) => {
      if (message.id !== id || !current.current) return;
      if (message.deleted) markConflict('deleted');
      else if (message.revision > revision.current) markConflict('changed');
    });
    return () => { mounted = false; generation.current = null; unsubscribe(); };
  }, [id, reload, markConflict]);
  const edit = useCallback((change) => {
    if (!current.current) return;
    try {
      const next = change(current.current);
      current.current = next; setDoc(next);
    } catch { announce('That change is not valid.'); }
  }, [announce]);
  useEffect(() => {
    if (!doc || doc === saved || conflict) return;
    let cancelled = false;
    let timer;
    const token = generation.current;
    async function save() {
      if (cancelled || blocked.current || token !== generation.current) return;
      // Only one pending save per editor, so rapid edits always use its returned revision.
      if (saving.current) { timer = setTimeout(save, 100); return; }
      saving.current = true;
      const result = await store.updateBeat(doc, revision.current);
      saving.current = false;
      if (token !== generation.current) return;
      setPersistent(result.persistent !== false);
      if (result.error) { markConflict(result.error === 'not_found' ? 'deleted' : 'changed'); return; }
      revision.current = result.revision;
      setSaved(doc);
      if (!blocked.current) announce(result.persistent ? 'Saved on this device' : 'Kept in memory for this visit');
    }
    timer = setTimeout(save, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [doc, saved, conflict, announce, markConflict]);
  async function copy() {
    if (!current.current) return null;
    const now = Date.now();
    const next = { ...structuredClone(current.current), id: crypto.randomUUID(), title: `${current.current.title.slice(0, 73)} (copy)`, createdAt: now, updatedAt: now };
    const result = await store.createBeat(next);
    if (result.error) { announce(result.error === 'limit' ? 'This device has 50 beats. Delete one to make room for a copy.' : 'Could not save a copy.'); return null; }
    return next.id;
  }
  return { doc, current, error, persistent, conflict, edit, reload, copy, dirty: doc !== saved };
}
