'use client';
import { assertBeatWritable, beatReadOnly, capabilityGeneration, assertBeatGeneration, subscribeBeatWrites, refuseBeatWrites, getBeatWriteVersion, withBeatVersionFloor } from '../../../_lib/music/beat/beatCompatibility.mjs';
import { beatFailure } from '../../../_lib/music/beat/beatErrors.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { useEffect, useRef, useState } from 'react';
import { getStoredUserId, onSessionChange } from '../../../../lib/authClient.js';
import * as api from '../../../_lib/music/beat/beatCloud.js';
import * as store from '../../../_lib/music/beat/beatStore.js';
import { configureCloudTakes } from '../../../_lib/music/beat/beatAssets.js';
import { parseCloudBeat, errorCode, errorState, maySync, needsSync, retryDelay, saveRequest, takesToUpload, takeAssets, sameAccount, isRemoved, removedLink } from '../../../_lib/music/beat/beatCloudRules.mjs';
const messages = { cloud_read_only: 'app.music.beat.compat.readOnly', read_only: 'app.music.beat.compat.writesDisabled', update_required: 'app.music.beat.compat.updateRequired', synced: 'app.music.beat.recovery.r18', syncing: 'app.music.beat.recovery.r19', offline: 'app.music.beat.recovery.r20',
  error: 'app.music.beat.recovery.r21', limit: 'app.music.beat.recovery.r22',
  rate_limited: 'app.music.beat.recovery.r23', conflict: 'app.music.beat.recovery.r24',
  removed: 'app.music.beat.recovery.r25',
  unlinked: 'app.music.beat.recovery.r26', other: 'app.music.beat.recovery.r27', signed_out: 'app.music.beat.recovery.r28' };
export function useBeatCloudSync({ beatId, project, cloud, announce }) {
  const { t } = useI18n();
  const latest = useRef(project);
  useEffect(() => { latest.current = project; });
  const control = useRef(null);
  const [view, setView] = useState({ state: 'unlinked', conflict: null, media: [], busy: false });
  useEffect(() => {
    if (!cloud) return;
    let active = true, generation = 0, userId = getStoredUserId(), controller = new AbortController();
    let timer, mediaTimer, firstQueued = 0, busy = false, conflict = null, paused = false, attempt = 0, retryAt = 0, terminal = null, pending = null;
    // An unchanged beat checks the account on open without consuming a write.
    let opened = false, syncedLocalRevision = null, state = '', refused = new Set(), takeRows = [], mediaRetryAt = 0;
    const capture = () => ({ userId, generation, writeGeneration: capabilityGeneration(), signal: controller.signal });
    const current = token => active && sameAccount(token, { userId: getStoredUserId(), generation }) && !token.signal.aborted;
    const check = token => { if (!current(token)) throw Object.assign(beatFailure('recovery-r29'), { code: 'account_changed' }); };
    function show(next, extra = {}, notify = true) {
      if (!active) return;
      setView(v => ({ ...v, state: next, conflict, busy, userId, ...extra }));
      if (notify && next !== state && messages[next]) announce(t(messages[next]));
      state = next;
    }
    function schedule(delay = 10000) {
      if (!active || paused || conflict || terminal || !userId) return;
      clearTimeout(timer);
      const now = Date.now(); firstQueued ||= now;
      const wait = Math.max(retryAt - now, Math.min(delay, Math.max(0, 60000 - (now - firstQueued))));
      timer = setTimeout(() => { firstQueued = 0; void cycle(); }, wait);
    }
    async function rowsFor(token) {
      const result = await api.listTakes(beatId, token); check(token); takeRows = result.takes;
      configureCloudTakes({ beatId, userId: token.userId, rows: result.takes,
        load: take => api.takeUrl(beatId, take.id, token), signal: token.signal });
      return result.takes;
    }
    async function media(doc, token, required = false) {
      clearTimeout(mediaTimer);
      if (!takeAssets(doc).length) { setView(v => ({ ...v, media: [] })); return; }
      const rows = [...await rowsFor(token)], failures = [];
      if (beatReadOnly(doc)) { writesDisabled(); return; }
      assertBeatGeneration(token.writeGeneration); assertBeatWritable(doc);
      // A transient upload failure backs off for 60 s even when document saves keep running.
      // Only an explicit Load theirs (required) retries before the deadline.
      const waiting = !required && Date.now() < mediaRetryAt;
      // An explicit Load theirs retries every take, including ones a background cycle refused.
      const pendingTakes = waiting ? [] : takesToUpload(doc, rows, required ? new Set() : refused);
      for (const [index, asset] of pendingTakes.entries()) {
        check(token);
        try {
          assertBeatGeneration(token.writeGeneration); assertBeatWritable(doc);
          const ready = await api.uploadTake(beatId, asset, rows.find(r => r.take_ref === asset.ref), { ...token, doc }); check(token);
          const row = { ...ready, take_ref: asset.ref, status: 'ready' };
          const existing = rows.findIndex(r => r.take_ref === asset.ref);
          if (existing < 0) rows.push(row); else rows[existing] = { ...rows[existing], ...row };
          refused.delete(asset.ref);
        } catch (error) {
          check(token); failures.push(asset.name);
          const code = errorCode(error);
          if (code === 'CAPABILITY_CHANGED') throw error;
          if (errorState(error) === 'read_only') { await handleWritesDisabled(error, token); if (required) throw error; return; }
          // Transient: rate limits, timeouts, 5xx and transport failures. A statusless local failure
          // (encoding, missing samples) is permanent so it cannot burn the write window every minute.
          const retryable = code === 'RATE_LIMITED' || (error.status === 409 && code === 'TAKE_UPLOAD_MISSING') ||
            [408, 425, 429].includes(error.status) || (!error.status && code === 'NETWORK_ERROR') ||
            (error.status >= 500 && error.status < 600);
          if (!retryable || ['TAKE_CHANGED', 'LIMIT_REACHED', 'TAKE_UNAVAILABLE'].includes(code)) refused.add(asset.ref);
          if (code === 'LIMIT_REACHED') pendingTakes.slice(index).forEach(a => refused.add(a.ref));
          if (retryable && !refused.has(asset.ref)) mediaRetryAt = Date.now() + 60000;
          if (['RATE_LIMITED', 'LIMIT_REACHED'].includes(code) || error.status === 429) break;
        }
      }
      takeRows = rows;
      configureCloudTakes({ beatId, userId: token.userId, rows, load: take => api.takeUrl(beatId, take.id, token), signal: token.signal });
      const missing = takesToUpload(doc, rows);
      setView(v => ({ ...v, media: missing.map(a => a.name) }));
      if (!required && missing.some(a => !refused.has(a.ref))) mediaTimer = setTimeout(() => { mediaRetryAt = 0; void cycle(); },
        mediaRetryAt ? Math.max(1000, Math.ceil((mediaRetryAt - Date.now()) / 1000) * 1000) : 60000);
      if (required && missing.length) throw Object.assign(beatFailure('details-d34', { names: missing.map(a => a.name).join(', ') }), { code: 'MEDIA_REQUIRED', names: failures });
    }
    function writesDisabled(error) {
      const localV5 = latest.current.current.current?.version === 5;
      terminal = localV5 ? 'read_only' : 'cloud_read_only'; conflict = null;
      if (localV5 && errorCode(error) === 'BEAT_WRITES_DISABLED') refuseBeatWrites();
      clearTimeout(timer); clearTimeout(mediaTimer);
      show(terminal);
    }
    async function handleWritesDisabled(error, token) {
      writesDisabled(error);
      if (errorCode(error) !== 'BEAT_WRITES_DISABLED' || latest.current.current.current?.version !== 4) return;
      try {
        const { record } = await store.getBeat(beatId); check(token);
        const theirs = await api.getCloudBeat(beatId, token); check(token);
        const doc = parseCloudBeat(theirs.doc_json, beatId);
        // A stale device can keep saving its local v4 edits. Only an unchanged
        // editor may adopt the account's read-only v5 document.
        if (doc.version !== 5 || latest.current.current.current !== latest.current.saved) return;
        assertBeatGeneration(token.writeGeneration);
        refuseBeatWrites();
        await latest.current.loadReadOnlyCloud(doc, { ...record.cloud, projectId: theirs.project.id,
          revision: theirs.project.revision, syncedUpdatedAt: doc.updatedAt }, record, () => current(token), capabilityGeneration());
        check(token); writesDisabled();
      } catch (readError) {
        if (!current(token)) return;
        if (errorState(readError) === 'update_required') updateRequired();
        // Keep local edits and the notice if the read fails or the editor changes.
      }
    }
    const unsubscribeWrites = subscribeBeatWrites(() => {
      if (terminal && !['read_only', 'cloud_read_only'].includes(terminal)) return;
      clearTimeout(timer); clearTimeout(mediaTimer);
      if (beatReadOnly(latest.current.current.current)) writesDisabled();
      else if (terminal === 'read_only' || terminal === 'cloud_read_only' && getBeatWriteVersion() === 5) {
        terminal = null; retryAt = 0; schedule(0);
      } else schedule();
    });
    function updateRequired() {
      terminal = 'update_required'; pending = null; conflict = null;
      clearTimeout(timer); clearTimeout(mediaTimer); show('update_required');
    }
    async function markRemoved(token) {
      terminal = 'removed'; pending = null; conflict = null; paused = false;
      clearTimeout(timer); clearTimeout(mediaTimer);
      const { record } = await store.getBeat(beatId); check(token);
      if (record?.cloud?.userId === token.userId) {
        const result = await store.setCloudLink(beatId, record.cloud, removedLink(token.userId)); check(token);
        if (result.error) { show('error'); return; }
      }
      show('removed');
    }
    async function getTheirs(token) {
      const result = await api.getCloudBeat(beatId, token); check(token);
      const doc = parseCloudBeat(result.doc_json, beatId);
      conflict = { doc: doc, revision: result.project.revision, projectId: result.project.id, token };
      paused = false; pending = null; show('conflict');
    }
    async function write(record, token, mode, expected) {
      assertBeatGeneration(token.writeGeneration); assertBeatWritable(record.doc); assertBeatWritable(latest.current.current.current);
      const body = saveRequest(record.doc, expected ?? record.cloud.revision, mode);
      const signature = JSON.stringify(body);
      if (!pending || pending.signature !== signature) pending = { signature, key: crypto.randomUUID() };
      const result = await api.saveCloudBeat(beatId, body, pending.key, token); check(token);
      pending = null;
      if (mode !== 'stash') {
        const link = { userId: token.userId, projectId: result.project.id, revision: result.project.revision, syncedUpdatedAt: record.doc.updatedAt };
        const saved = await store.setCloudLink(beatId, record.cloud, link); check(token);
        if (saved.error) throw Object.assign(beatFailure('recovery-r30'), { code: 'LOCAL_CONFLICT' });
        syncedLocalRevision = record.revision;
      }
      return result;
    }
    async function cycle(mode = 'autosave', lifecycle = false) {
      if (busy || conflict || paused || terminal || !active || !userId) return;
      const token = capture(); busy = true;
      try {
        if (mode === 'checkpoint' || lifecycle) { await latest.current.flushLatest(); check(token); }
        const { record } = await store.getBeat(beatId); check(token);
        if (!record) return;
        if (!maySync(record.cloud, userId)) {
          if (record.cloud?.userId === userId && isRemoved(record.cloud)) terminal = 'removed';
          show(terminal || (record.cloud ? 'other' : 'unlinked')); return;
        }
        const save = mode === 'checkpoint' || needsSync(record, userId, syncedLocalRevision);
        if (lifecycle && (!save || new TextEncoder().encode(JSON.stringify(saveRequest(record.doc, record.cloud.revision, mode))).length > 64000)) return;
        syncedLocalRevision ??= record.revision;
        let mediaDoc = record.doc, updatedFromCloud = false;
        if (!save && !opened && !lifecycle) {
          const theirs = await api.getCloudBeat(beatId, token); check(token);
          const doc = parseCloudBeat(theirs.doc_json, beatId);
          opened = true;
          if (theirs.project.revision > record.cloud.revision) {
            if (beatReadOnly(doc)) {
              await latest.current.loadReadOnlyCloud(doc, { ...record.cloud, projectId: theirs.project.id, revision: theirs.project.revision, syncedUpdatedAt: doc.updatedAt }, record, () => current(token), token.writeGeneration);
            } else await latest.current.replaceFromCloud(doc, theirs.project.revision, null, null,
              () => current(token), theirs.project.id, record);
            check(token);
            const updated = await store.getBeat(beatId); check(token);
            syncedLocalRevision = updated.record.revision;
            mediaDoc = updated.record.doc; updatedFromCloud = true;
          }
        }
        if (save) show('syncing');
        if (save) await write(record, { ...token, keepalive: lifecycle }, mode);
        if (!lifecycle) await media(mediaDoc, token);
        if (beatReadOnly(mediaDoc) || ['read_only', 'cloud_read_only'].includes(terminal)) { writesDisabled(); return; }
        check(token); attempt = 0; retryAt = 0; show('synced', {}, !updatedFromCloud);
        const fresh = await store.getBeat(beatId); check(token);
        if (fresh.record && needsSync(fresh.record, userId, syncedLocalRevision)) schedule();
      } catch (error) {
        if (!current(token)) return;
        if (errorCode(error) === 'CAPABILITY_CHANGED') {
          if (beatReadOnly(latest.current.current.current)) writesDisabled();
          else schedule(0);
          return;
        }
        if (errorCode(error) === 'LOCAL_CONFLICT') { schedule(); return; }
        const next = errorState(error);
        if (next === 'read_only') { await handleWritesDisabled(error, token);
        } else if (next === 'update_required' && (errorCode(error) !== 'BEAT_CLIENT_OUTDATED' || getBeatWriteVersion() < 5)) { updateRequired();
        } else if (next === 'removed') {
          await markRemoved(token);
        } else if (next === 'conflict' || errorCode(error) === 'BEAT_CLIENT_OUTDATED') {
          try { await getTheirs(token); } catch (readError) {
            if (current(token)) {
              if (errorState(readError) === 'update_required') updateRequired();
              else if (errorState(readError) === 'removed') await markRemoved(token);
              else { show('offline'); retryAt = Date.now() + 10000; schedule(); }
            }
          }
        } else {
          show(next); const delay = retryDelay(attempt++, error);
          if (delay === null) terminal = next;
          else { retryAt = Date.now() + delay; schedule(delay); }
        }
      } finally { if (current(token)) { busy = false; setView(v => ({ ...v, busy: false })); } }
    }
    async function link() {
      if (!userId || busy) return;
      const token = capture(), { record } = await store.getBeat(beatId); check(token);
      assertBeatGeneration(token.writeGeneration); assertBeatWritable(record?.doc); assertBeatWritable(latest.current.current.current);
      if (!record || (record.cloud && !(record.cloud.userId === userId && isRemoved(record.cloud)))) return;
      const result = await store.setCloudLink(beatId, record.cloud || null, { userId, projectId: null, revision: 0, syncedUpdatedAt: 0 }); check(token);
      if (result.error === 'capability_changed') throw Object.assign(new Error(result.error), { code: result.error });
      if (result.error) { if (errorState({ code: result.error }) === 'read_only') writesDisabled(); else show('error'); return; }
      terminal = null; await cycle();
    }
    async function linkWithRetry() {
      try { await link(); } catch (error) {
        if (!active || errorCode(error) === 'ACCOUNT_CHANGED') return;
        if (errorCode(error) === 'CAPABILITY_CHANGED' && !beatReadOnly(latest.current.current.current)) return linkWithRetry();
        if (errorState(error) === 'read_only' || beatReadOnly(latest.current.current.current)) await handleWritesDisabled(error, capture());
        else show('error');
      }
    }
    async function resolve(choice) {
      if (!conflict || busy) return;
      let retryCapability = false;
      const theirs = conflict, token = theirs.token; check(token); busy = true; show('conflict', { detail: '' });
      try {
        assertBeatGeneration(token.writeGeneration);
        if (theirs.doc.version > latest.current.current.current.version) latest.current.raiseVersionFloor(theirs.doc.version);
        if (choice === 'mine') {
          await latest.current.flushLatest(); check(token);
          const { record } = await store.getBeat(beatId); check(token);
          if (!maySync(record?.cloud, token.userId)) throw beatFailure('recovery-r30');
          await write(record, token, 'checkpoint', theirs.revision);
          await media(record.doc, token);
        } else {
          await latest.current.replaceFromCloud(theirs.doc, theirs.revision,
            async doc => {
              const { record } = await store.getBeat(beatId); check(token);
              await write({ ...record, doc: withBeatVersionFloor(doc, theirs.doc.version) }, token, 'stash', theirs.revision);
            }, doc => media(doc, token, true), () => current(token), theirs.projectId);
          syncedLocalRevision = null;
        }
        if (['read_only', 'cloud_read_only'].includes(terminal) || beatReadOnly(latest.current.current.current)) return;
        check(token); conflict = null; paused = false; show('synced'); schedule();
      } catch (error) {
        if (!current(token)) return;
        if (errorCode(error) === 'CAPABILITY_CHANGED') {
          if (beatReadOnly(latest.current.current.current)) writesDisabled();
          else { conflict = { ...theirs, token: capture() }; retryCapability = true; }
        } else if (errorState(error) === 'read_only') await handleWritesDisabled(error, token);
        else if (errorState(error) === 'update_required' && (errorCode(error) !== 'BEAT_CLIENT_OUTDATED' || getBeatWriteVersion() < 5)) updateRequired();
        else if (errorState(error) === 'removed') await markRemoved(token);
        else if (['VERSION_CONFLICT', 'BEAT_CLIENT_OUTDATED'].includes(errorCode(error))) {
          try { await getTheirs(token); } catch { if (current(token)) show('conflict', { detail: t('app.music.beat.status.s80') }); }
        }
        else show('conflict', { detail: t('app.music.beat.status.s81') });
      } finally { if (current(token)) { busy = false; setView(v => ({ ...v, busy: false })); } }
      if (retryCapability && current(token)) return resolve(choice);
    }
    function session() {
      const next = getStoredUserId(); if (next === userId) return;
      generation++; controller.abort(); controller = new AbortController();
      clearTimeout(timer); clearTimeout(mediaTimer); firstQueued = 0; busy = false; conflict = null; paused = false;
      pending = null; opened = false; syncedLocalRevision = null; refused = new Set(); takeRows = []; mediaRetryAt = 0; terminal = null; retryAt = 0; userId = next;
      configureCloudTakes(null); show(userId ? 'unlinked' : 'signed_out', { media: [], detail: '' });
      if (userId) schedule(0);
    }
    const unsubscribe = onSessionChange(session);
    const hidden = () => { if (document.hidden) void cycle('autosave', true); };
    const hide = () => void cycle('autosave', true);
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', hide);
    control.current = { queue: schedule, link: linkWithRetry, resolve, checkpoint: () => cycle('checkpoint'),
      retry: () => { terminal = null; retryAt = 0; paused = false; if (conflict) show('conflict'); else void cycle(); },
      later: () => {
        generation++; controller.abort(); controller = new AbortController();
        if (conflict) conflict = { ...conflict, token: capture() };
        paused = true; busy = false;
        configureCloudTakes({ beatId, userId, rows: takeRows, signal: controller.signal, load: take => api.takeUrl(beatId, take.id, capture()) });
        setView(v => ({ ...v, conflict: null, busy: false }));
      },
      options: capture, current,
    };
    if (userId) schedule(0); else show('signed_out');
    return () => {
      active = false; generation++; controller.abort(); clearTimeout(timer); clearTimeout(mediaTimer); unsubscribe(); unsubscribeWrites();
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', hide);
      configureCloudTakes(null); control.current = null;
    };
  }, [beatId, cloud, announce, t]);
  useEffect(() => { if (project.saved) control.current?.queue(); }, [project.saved]);
  return { ...view, message: messages[view.state] ? t(messages[view.state]) : '', link: () => control.current?.link(), retry: () => control.current?.retry(),
    resolve: choice => control.current?.resolve(choice), later: () => control.current?.later(), checkpoint: () => control.current?.checkpoint(),
    options: () => control.current?.options(), current: token => control.current?.current(token) };
}
