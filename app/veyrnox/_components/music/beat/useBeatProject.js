'use client';
import { assertBeatWritable, beatReadOnly, BEAT_READ_ONLY_MESSAGE, capabilityGeneration, assertBeatGeneration, subscribeBeatWrites, withBeatVersionFloor } from '../../../_lib/music/beat/beatCompatibility.mjs';
import { validateBeat } from '../../../_lib/music/beat/beatDocument.mjs';
import { beatFailure } from '../../../_lib/music/beat/beatErrors.mjs';
import { beatText } from '../../../_lib/music/beat/beatDisplay.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { actionLabel } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { recordingEditAllowed } from '../../../_lib/music/beat/beatRecordingPolicy.mjs';
import { arrangementMessage } from '../../../_lib/music/beat/beatMessages.mjs';
import * as historyOps from '../../../_lib/music/beat/beatHistory.mjs';
import { tryOp, selectPattern as selectPatternOp } from '../../../_lib/music/beat/beatOps.mjs';
import { localTakeIds, hydrateLocalTakes } from '../../../_lib/music/localTakes.js';
import { reconcileBeatTakes } from '../../../_lib/music/beat/beatTakeStore.js';
import { createDeviceCopy, replaceAfterStash } from '../../../_lib/music/beat/beatCloudRules.mjs';
import * as store from '../../../_lib/music/beat/beatStore.js';

export function useBeatProject(id, announce) {
  const { t } = useI18n();
  const [doc, setDoc] = useState(null);
  const [capability, setCapability] = useState(capabilityGeneration());
  useEffect(() => subscribeBeatWrites(() => setCapability(capabilityGeneration())), []);
  const floor = useRef(4);
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
  const inFlight = useRef(Promise.resolve()), replacing = useRef(false), durable = useRef(true);
  const flushRequested = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const recordedAnnouncement = useRef(-Infinity);
  const writable = useCallback(() => {
    try { assertBeatWritable(current.current); return true; }
    catch { announce(t(BEAT_READ_ONLY_MESSAGE)); return false; }
  }, [announce, t]);
  const normalize = useCallback((next) => {
    const normalized = withBeatVersionFloor(next, floor.current);
    assertBeatWritable(normalized);
    if (!validateBeat(normalized).ok) throw new Error('invalid');
    return normalized;
  }, []);
  const markConflict = useCallback((kind) => {
    blocked.current = kind;
    if (mounted.current) {
      setConflict(kind);
      announce(kind === 'deleted' ? t('app.music.beat.ui.this.beat.was.deleted.in.another.tab') : t('app.music.beat.ui.this.beat.was.changed.in.another.tab'));
    }
  }, [announce, t]);
  const flush = useCallback(async function savePending() {
    if (replacing.current || blocked.current || !unsaved.current) return;
    // Lifecycle flushes queue behind an in-flight save and use its returned revision.
    if (saving.current) { flushRequested.current = true; return; }
    if (!writable()) return;
    saving.current = true; flushRequested.current = false;
    const pendingDoc = unsaved.current;
    const token = generation.current;
    inFlight.current = store.updateBeat(pendingDoc, revision.current).then(async result => {
      if (!result.error && result.persistent) await reconcileBeatTakes(pendingDoc).catch(() => announce(t('app.music.beat.status.s94')));
      return result;
    });
    const result = await inFlight.current;
    saving.current = false;
    if (token !== generation.current) return;
    durable.current = result.persistent !== false;
    if (mounted.current) setPersistent(result.persistent !== false);
    if (result.error === 'conflict') markConflict('changed');
    else if (result.error === 'not_found') markConflict('deleted');
    else if (result.error) {
      if (mounted.current) { setSaveError(true); announce(t(['v5_write_disabled', 'capability_changed'].includes(result.error) ? BEAT_READ_ONLY_MESSAGE : result.error === 'unsupported_version' ? 'app.music.beat.compat.updateRequired' : 'app.music.beat.status.s95')); }
    } else {
      revision.current = result.revision;
      if (unsaved.current === pendingDoc) unsaved.current = null;
      if (mounted.current) {
        setSaved(pendingDoc); setSaveError(false);
        if (!blocked.current) announce(result.persistent ? t('app.music.beat.ui.saved.on.this.device') : t('app.music.beat.ui.kept.in.memory.for.this.visit'));
      }
    }
    if (flushRequested.current) return savePending();
    return result.error ? null : pendingDoc;
  }, [announce, markConflict, t, writable]);
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
    floor.current = Math.max(floor.current, result.record.doc.version);
    result.record.doc = withBeatVersionFloor(result.record.doc, floor.current);
    revision.current = result.record.revision; current.current = result.record.doc; blocked.current = null;
    history.current = historyOps.createHistory(result.record.doc);
    unsaved.current = null; flushRequested.current = false;
    setDoc(result.record.doc); setSaved(result.record.doc); setConflict(null); setError(''); setSaveError(false);
  }, [id, markConflict]);
  useEffect(() => {
    mounted.current = true;
    Promise.resolve().then(() => { if (mounted.current) reload(); });
    const unsubscribe = store.subscribeBeats((message) => {
      if (message.storageReady && !current.current) { void reload(); return; }
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
    next = normalize(next); floor.current = Math.max(floor.current, next.version);
    unsaved.current = next;
    current.current = next; setDoc(next); setSaveError(false);
  }, [normalize]);
  const edit = useCallback((change, options = {}) => {
    if (!current.current || replacing.current || !writable()) return null;
    if (!recordingEditAllowed(recordingState.current(), options)) { announce(t('app.music.beat.status.s10')); return null; }
    try {
      const result = tryOp(current.current, change);
      if (result.refused) { announce(beatText(result.refused, t)); return null; }
      const next = normalize(result.doc);
      if (next === current.current) return null;
      const resultMessage = arrangementMessage(current.current, next, options, t);
      history.current = historyOps.record(history.current, next, options);
      accept(next);
      if (options.message || !options.key) {
        if (options.label === BEAT_ACTIONS.a41) {
          const now = Date.now();
          if (now - recordedAnnouncement.current >= 2000) {
            recordedAnnouncement.current = now;
            announce(options.message || t('app.music.beat.status.s96'));
          }
        } else {
          announce(options.message || resultMessage || t('app.music.beat.status.s97', { p0: actionLabel(options.label || t('app.music.beat.status.s113'), t) }));
        }
      }
      return history.current.past.at(-1)?.id;
    } catch { announce(t('app.music.beat.status.s98')); return null; }
  }, [announce, accept, t, normalize, writable]);
  const selectPattern = useCallback((slot) => {
    if (replacing.current || recordingState.current() || !writable()) return;
    if (!current.current || slot === current.current.currentPattern) return;
    const next = normalize(selectPatternOp(current.current, slot));
    history.current = historyOps.replacePresent(history.current, next);
    accept(next);
  }, [accept, normalize, writable]);
  const travel = useCallback((direction) => {
    if (replacing.current || !history.current || recordingState.current() || !writable()) return;
    const entry = (direction === 'undo' ? history.current.past : history.current.future).at(-1);
    if (!entry) return;
    const travelled = historyOps[direction](history.current);
    const next = normalize({ ...travelled.present, updatedAt: Math.max(Date.now(), current.current.updatedAt) });
    history.current = travelled;
    history.current = historyOps.replacePresent(history.current, next);
    accept(next);
    announce(t('app.music.beat.status.s114', { p0: direction === 'undo' ? t('app.music.beat.status.s115') : t('app.music.beat.status.s116'), p1: actionLabel(entry.label, t) }));
  }, [accept, announce, t, normalize, writable]);
  useEffect(() => {
    if (!doc || doc === saved || conflict || beatReadOnly(doc)) return;
    const timer = setTimeout(flush, 800);
    return () => clearTimeout(timer);
  }, [doc, saved, conflict, flush, capability]);
  async function copy(source) {
    const captured = capabilityGeneration();
    if (!writable()) return null;
    const finalized = await beforeFlush.current?.() || current.current;
    const copyDoc = source || finalized;
    if (!copyDoc) return null;
    await hydrateLocalTakes();
    try { assertBeatGeneration(captured); assertBeatWritable(copyDoc); } catch { announce(t(BEAT_READ_ONLY_MESSAGE)); return null; }
    const result = await createDeviceCopy(copyDoc, localTakeIds().map(id => ({ id })), store.createBeat, crypto.randomUUID(), Date.now());
    if (result.error) {
      announce(result.error === 'cloud_only_takes' ? t('app.music.beat.recovery.r38') : result.error === 'limit' ? t('app.music.beat.status.s99') : t('app.music.beat.status.s100')); return null;
    }
    return result.id;
  }
  async function flushLatest() {
    const captured = capabilityGeneration();
    if (unsaved.current) assertBeatWritable(current.current);
    await beforeFlush.current?.();
    await inFlight.current;
    assertBeatGeneration(captured);
    await flush();
    await inFlight.current;
    if (blocked.current || unsaved.current || !durable.current) throw beatFailure('recovery-r31');
  }
  async function replaceFromCloud(theirsDoc, theirsRevision, stash, media, isCurrent, cloudProjectId, expected = null) {
    const capturedGeneration = capabilityGeneration();
    assertBeatWritable(current.current);
    theirsDoc = normalize(withBeatVersionFloor(theirsDoc, current.current.version));
    if (replacing.current || blocked.current) throw beatFailure('recovery-r32');
    await beforeFlush.current?.(); replacing.current = true;
    try {
      await replaceAfterStash({
        latest: async () => {
          await inFlight.current;
          if (expected && (revision.current !== expected.revision || JSON.stringify(current.current) !== JSON.stringify(expected.doc)))
            throw Object.assign(beatFailure('recovery-r33'), { code: 'LOCAL_CONFLICT' });
          return { doc: current.current, revision: revision.current };
        },
        media, stash: stash && (doc => stash(normalize(withBeatVersionFloor(doc, theirsDoc.version)))),
        current: captured => isCurrent() && !blocked.current && current.current === captured.doc && revision.current === captured.revision,
        replace: async captured => {
          const record = await store.getBeat(id);
          if (!record.record?.cloud || !isCurrent()) return { error: 'account_changed' };
          assertBeatGeneration(capturedGeneration);
          const result = await store.updateBeat(theirsDoc, captured.revision, { current: isCurrent,
            link: { ...record.record.cloud, projectId: cloudProjectId || record.record.cloud.projectId, revision: theirsRevision, syncedUpdatedAt: theirsDoc.updatedAt } });
          if (result.error) return result;
          await reload(); return result;
        },
      });
      announce(expected ? t('app.music.beat.status.s101') : t('app.music.beat.status.s102'));
    } finally { replacing.current = false; void flush(); }
  }
  function raiseVersionFloor(version) {
    const next = normalize(withBeatVersionFloor(current.current, version));
    floor.current = Math.max(floor.current, version);
    if (next !== current.current) { history.current = historyOps.replacePresent(history.current, next); accept(next); }
  }
  async function loadReadOnlyCloud(theirs, cloud, expected, isCurrent, captured) {
    if (unsaved.current || current.current !== expected.doc && JSON.stringify(current.current) !== JSON.stringify(expected.doc))
      throw Object.assign(beatFailure('recovery-r33'), { code: 'LOCAL_CONFLICT' });
    const before = current.current;
    const unchanged = () => isCurrent() && !unsaved.current && current.current === before && revision.current === expected.revision;
    const result = await store.loadCloudBeat(theirs, cloud, { expectedRevision: expected.revision, current: unchanged, generation: captured });
    if (result.error) throw Object.assign(new Error(result.error), { code: result.error });
    await reload();
  }
  return { readOnly: beatReadOnly(doc), raiseVersionFloor, loadReadOnlyCloud, doc, saved, flushLatest, replaceFromCloud, current, finishRecording: () => beforeFlush.current?.(), registerFinalizer, registerRecordingState, error, persistent, conflict, saveError, retry: flush, edit, reload, copy, selectPattern,
    undo: () => travel('undo'), redo: () => travel('redo'),
    canUndo: !beatReadOnly(doc) && Boolean(history.current && historyOps.canUndo(history.current)),
    canRedo: !beatReadOnly(doc) && Boolean(history.current && historyOps.canRedo(history.current)),
    undoId: history.current?.past.at(-1)?.id, dirty: doc !== saved };
}
