'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { recordingEditAllowed, RECORDING_LOCK_REASON } from '../../../_lib/music/beat/beatRecordingPolicy.mjs';
import { arrangementMessage } from '../../../_lib/music/beat/beatMessages.mjs';
import * as historyOps from '../../../_lib/music/beat/beatHistory.mjs';
import { tryOp, selectPattern as selectPatternOp } from '../../../_lib/music/beat/beatOps.mjs';
import { getShelf, hydrateShelf } from '../../../_lib/music/instrumentShelf.js';
import { createDeviceCopy, COPY_TAKES_MESSAGE, replaceAfterStash } from '../../../_lib/music/beat/beatCloudRules.mjs';
import * as store from '../../../_lib/music/beat/beatStore.js';

export function useBeatProject(id, announce) {
  const [doc, setDoc] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [persistent, setPersistent] = useState(true);
  const [conflict, setConflict] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const current = useRef(null);
  const beforeFlush = useRef(null);
  const recordingState = useRef(() => false);
  const registerRecordingState = useCallback((callback) => { recordingState.current = callback; }, []);
  const registerFinalizer = useCallback((callback) => { beforeFlush.current = callback; }, []);
  const history = useRef(null);
  const unsaved = useRef(null);
  const revision = useRef(0);
  const blocked = useRef(null);
  const saving = useRef(false);
  const inFlight = useRef(Promise.resolve()), replacing = useRef(false);
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
    if (replacing.current || blocked.current || !unsaved.current) return;
    // Lifecycle flushes queue behind an in-flight save and use its returned revision.
    if (saving.current) { flushRequested.current = true; return; }
    saving.current = true; flushRequested.current = false;
    const pendingDoc = unsaved.current;
    const token = generation.current;
    inFlight.current = store.updateBeat(pendingDoc, revision.current);
    const result = await inFlight.current;
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
      if (message.cloud || message.id !== id || !current.current) return;
      if (message.deleted) markConflict('deleted');
      else if (message.revision > revision.current) markConflict('changed');
    });
    function lifecycleFlush() { beforeFlush.current?.(); void flush(); }
    function hidden() { if (document.hidden) void flush(); }
    window.addEventListener('pagehide', lifecycleFlush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      mounted.current = false;
      lifecycleFlush();
      unsubscribe();
      window.removeEventListener('pagehide', lifecycleFlush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [id, reload, markConflict, flush]);
  const accept = useCallback((next) => {
    unsaved.current = next;
    current.current = next; setDoc(next); setSaveError(false);
  }, []);
  const edit = useCallback((change, options = {}) => {
    if (!current.current || replacing.current) return null;
    if (!recordingEditAllowed(recordingState.current(), options)) { announce(RECORDING_LOCK_REASON); return null; }
    try {
      const result = tryOp(current.current, change);
      if (result.refused) { announce(result.refused); return null; }
      const next = result.doc;
      if (next === current.current) return null;
      const resultMessage = arrangementMessage(current.current, next, options);
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
          announce(options.message || resultMessage || `Changed: ${options.label || 'edit beat'}`);
        }
      }
      return history.current.past.at(-1)?.id;
    } catch { announce('That change is not valid.'); return null; }
  }, [announce, accept]);
  const selectPattern = useCallback((slot) => {
    if (replacing.current || recordingState.current()) return;
    if (!current.current || slot === current.current.currentPattern) return;
    const next = selectPatternOp(current.current, slot);
    history.current = historyOps.replacePresent(history.current, next);
    accept(next);
  }, [accept]);
  const travel = useCallback((direction) => {
    if (replacing.current || !history.current || recordingState.current()) return;
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
  async function copy(source) {
    const finalized = beforeFlush.current?.() || current.current;
    const copyDoc = source || finalized;
    if (!copyDoc) return null;
    await hydrateShelf();
    const result = await createDeviceCopy(copyDoc, getShelf(), store.createBeat, crypto.randomUUID(), Date.now());
    if (result.error) {
      announce(result.error === 'cloud_only_takes' ? COPY_TAKES_MESSAGE : result.error === 'limit' ? 'This device has 50 beats. Delete one to make room for a copy.' : 'Could not save a copy.'); return null;
    }
    return result.id;
  }
  async function flushLatest() {
    beforeFlush.current?.();
    await inFlight.current;
    await flush();
    await inFlight.current;
    if (blocked.current || unsaved.current) throw new Error('Local save incomplete');
  }
  async function replaceFromCloud(theirsDoc, theirsRevision, stash, media, isCurrent, cloudProjectId) {
    if (replacing.current || blocked.current) throw new Error('Local beat is busy');
    beforeFlush.current?.(); replacing.current = true;
    try {
      await replaceAfterStash({
        latest: async () => { await inFlight.current; return { doc: current.current, revision: revision.current }; },
        media, stash,
        current: captured => isCurrent() && !blocked.current && current.current === captured.doc && revision.current === captured.revision,
        replace: async captured => {
          const record = await store.getBeat(id);
          if (!record.record?.cloud || !isCurrent()) return { error: 'account_changed' };
          const result = await store.updateBeat(theirsDoc, captured.revision, { current: isCurrent,
            link: { ...record.record.cloud, projectId: cloudProjectId || record.record.cloud.projectId, revision: theirsRevision, syncedUpdatedAt: theirsDoc.updatedAt } });
          if (result.error) return result;
          await reload(); return result;
        },
      });
      announce('Loaded the account version; your changes are saved in Versions');
    } finally { replacing.current = false; void flush(); }
  }
  return { doc, saved, flushLatest, replaceFromCloud, current, registerFinalizer, registerRecordingState, error, persistent, conflict, saveError, retry: flush, edit, reload, copy, selectPattern,
    undo: () => travel('undo'), redo: () => travel('redo'),
    canUndo: Boolean(history.current && historyOps.canUndo(history.current)),
    canRedo: Boolean(history.current && historyOps.canRedo(history.current)),
    undoId: history.current?.past.at(-1)?.id, dirty: doc !== saved };
}
