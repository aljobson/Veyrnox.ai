'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as historyOps from '../../../_lib/music/beat/beatHistory.mjs';
import { tryOp, selectPattern as selectPatternOp } from '../../../_lib/music/beat/beatOps.mjs';
import * as store from '../../../_lib/music/beat/beatStore.js';

export function useBeatProject(id, announce) {
  const [doc, setDoc] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [persistent, setPersistent] = useState(true);
  const [conflict, setConflict] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const current = useRef(null);
  const history = useRef(null);
  const unsaved = useRef(null);
  const revision = useRef(0);
  const blocked = useRef(null);
  const saving = useRef(false);
  const flushRequested = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const recordedAnnouncement = useRef(-Infinity);
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
    history.current = historyOps.createHistory(result.record.doc);
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
  const accept = useCallback((next) => {
    unsaved.current = next;
    current.current = next; setDoc(next); setSaveError(false);
  }, []);
  const edit = useCallback((change, options = {}) => {
    if (!current.current) return null;
    try {
      const result = tryOp(current.current, change);
      if (result.refused) { announce(result.refused); return null; }
      const next = result.doc;
      if (next === current.current) return null;
      history.current = historyOps.record(history.current, next, options);
      accept(next);
      if (options.message || !options.key) {
        if (options.label === 'record hit') {
          const now = Date.now();
          if (now - recordedAnnouncement.current >= 2000) {
            recordedAnnouncement.current = now;
            announce(options.message || 'Recorded hit');
          }
        } else {
          announce(options.message || `Changed: ${options.label || 'edit beat'}`);
        }
      }
      return history.current.past.at(-1)?.id;
    } catch { announce('That change is not valid.'); return null; }
  }, [announce, accept]);
  const selectPattern = useCallback((slot) => {
    if (!current.current || slot === current.current.currentPattern) return;
    const next = selectPatternOp(current.current, slot);
    history.current = historyOps.replacePresent(history.current, next);
    accept(next);
  }, [accept]);
  const travel = useCallback((direction) => {
    if (!history.current) return;
    const entry = (direction === 'undo' ? history.current.past : history.current.future).at(-1);
    if (!entry) return;
    history.current = historyOps[direction](history.current);
    const next = { ...history.current.present, updatedAt: Math.max(Date.now(), current.current.updatedAt) };
    history.current = historyOps.replacePresent(history.current, next);
    accept(next);
    announce(`${direction === 'undo' ? 'Undid' : 'Redid'}: ${entry.label}`);
  }, [accept, announce]);
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
  return { doc, current, error, persistent, conflict, saveError, retry: flush, edit, reload, copy, selectPattern,
    undo: () => travel('undo'), redo: () => travel('redo'),
    canUndo: Boolean(history.current && historyOps.canUndo(history.current)),
    canRedo: Boolean(history.current && historyOps.canRedo(history.current)),
    undoId: history.current?.past.at(-1)?.id, dirty: doc !== saved };
}
