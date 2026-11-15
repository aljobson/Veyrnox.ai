'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as store from '../../../_lib/music/beat/beatStore.js';

export function useBeatProject(id, announce) {
  const [doc, setDoc] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [persistent, setPersistent] = useState(true);
  const [conflict, setConflict] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const current = useRef(null);
  const unsaved = useRef(null);
  const revision = useRef(0);
  const blocked = useRef(null);
  const saving = useRef(false);
  const flushRequested = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const markConflict = useCallback((kind) => {
    blocked.current = kind;
    if (mounted.current) {
      setConflict(kind);
      announce(kind === 'deleted' ? 'This beat was deleted in another tab' : 'This beat was changed in another tab');
    }
  }, [announce]);
  const flush = useCallback(async function savePending() {
    if (blocked.current || !unsaved.current) return;
    // Lifecycle flushes queue behind an in-flight save and use its returned revision.
    if (saving.current) { flushRequested.current = true; return; }
    saving.current = true; flushRequested.current = false;
    const pendingDoc = unsaved.current;
    const token = generation.current;
    const result = await store.updateBeat(pendingDoc, revision.current);
    saving.current = false;
    if (token !== generation.current) return;
    if (mounted.current) setPersistent(result.persistent !== false);
    if (result.error === 'conflict') markConflict('changed');
    else if (result.error === 'not_found') markConflict('deleted');
    else if (result.error) {
      if (mounted.current) { setSaveError(true); announce("Couldn't save on this device. Retry"); }
    } else {
      revision.current = result.revision;
      if (unsaved.current === pendingDoc) unsaved.current = null;
      if (mounted.current) {
        setSaved(pendingDoc); setSaveError(false);
        if (!blocked.current) announce(result.persistent ? 'Saved on this device' : 'Kept in memory for this visit');
      }
    }
    if (flushRequested.current) return savePending();
  }, [announce, markConflict]);
  const reload = useCallback(async () => {
    const token = {}; generation.current = token;
    const result = await store.getBeat(id);
    if (!mounted.current || token !== generation.current) return;
    setPersistent(result.persistent !== false);
    if (!result.record) {
      if (current.current && result.error === 'not_found') markConflict('deleted');
      else setError(result.error);
      return;
    }
    revision.current = result.record.revision; current.current = result.record.doc; blocked.current = null;
    unsaved.current = null; flushRequested.current = false;
    setDoc(result.record.doc); setSaved(result.record.doc); setConflict(null); setError(''); setSaveError(false);
  }, [id, markConflict]);
  useEffect(() => {
    mounted.current = true;
    Promise.resolve().then(() => { if (mounted.current) reload(); });
    const unsubscribe = store.subscribeBeats((message) => {
      if (message.id !== id || !current.current) return;
      if (message.deleted) markConflict('deleted');
      else if (message.revision > revision.current) markConflict('changed');
    });
    function hidden() { if (document.hidden) void flush(); }
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      mounted.current = false;
      void flush();
      unsubscribe();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [id, reload, markConflict, flush]);
  const edit = useCallback((change) => {
    if (!current.current) return;
    try {
      const next = change(current.current);
      if (next === current.current) return;
      unsaved.current = next;
      current.current = next; setDoc(next); setSaveError(false);
    } catch { announce('That change is not valid.'); }
  }, [announce]);
  useEffect(() => {
    if (!doc || doc === saved || conflict) return;
    const timer = setTimeout(flush, 800);
    return () => clearTimeout(timer);
  }, [doc, saved, conflict, flush]);
  async function copy() {
    if (!current.current) return null;
    const now = Date.now();
    const next = { ...structuredClone(current.current), id: crypto.randomUUID(), title: `${current.current.title.slice(0, 73)} (copy)`, createdAt: now, updatedAt: now };
    const result = await store.createBeat(next);
    if (result.error) { announce(result.error === 'limit' ? 'This device has 50 beats. Delete one to make room for a copy.' : 'Could not save a copy.'); return null; }
    return next.id;
  }
  return { doc, current, error, persistent, conflict, saveError, retry: flush, edit, reload, copy, dirty: doc !== saved };
}
