'use client';
import { useEffect, useRef, useState } from 'react';
import { getStoredUserId, onSessionChange } from '../../../../lib/authClient.js';
import * as api from '../../../_lib/music/beat/beatCloud.js';
import * as store from '../../../_lib/music/beat/beatStore.js';
import { migrateBeat, validateBeat } from '../../../_lib/music/beat/beatDocument.mjs';
import { configureCloudTakes } from '../../../_lib/music/beat/beatAssets.js';
import { errorCode, errorState, maySync, needsSync, retryDelay, saveRequest, takesToUpload, takeAssets, sameAccount } from '../../../_lib/music/beat/beatCloudRules.mjs';
const messages = { synced: 'Saved to your account', syncing: 'Saving to your account…', offline: 'Only on this device — offline',
  error: 'Not saved to your account — Retry', limit: 'Your account holds 50 beats. This one stays on this device.',
  rate_limited: 'Saving paused. Trying again in a minute.', conflict: 'Your account has another version of this beat.',
  unlinked: 'Only on this device — Save to your account', other: 'Saved to another account', signed_out: 'Only on this device — Sign in to save to your account' };
export function useBeatCloudSync({ beatId, project, cloud, announce }) {
  const latest = useRef(project);
  useEffect(() => { latest.current = project; });
  const control = useRef(null);
  const [view, setView] = useState({ state: 'unlinked', conflict: null, media: [], busy: false });
  useEffect(() => {
    if (!cloud) return;
    let active = true, generation = 0, userId = getStoredUserId(), controller = new AbortController();
    let timer, mediaTimer, firstQueued = 0, busy = false, conflict = null, paused = false, attempt = 0, retryAt = 0, terminal = false, pending = null;
    // Revalidate with a revisioned save on open; a timestamp alone cannot prove document equality.
    let syncedLocalRevision = null, state = '', refused = new Set(), takeRows = [];
    const capture = () => ({ userId, generation, signal: controller.signal });
    const current = token => active && sameAccount(token, { userId: getStoredUserId(), generation }) && !token.signal.aborted;
    const check = token => { if (!current(token)) throw Object.assign(new Error('Account changed'), { code: 'account_changed' }); };
    function show(next, extra = {}) {
      if (!active) return;
      setView(v => ({ ...v, state: next, conflict, busy, userId, ...extra }));
      if (next !== state && messages[next]) announce(messages[next]);
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
      let rows = await rowsFor(token), failures = [];
      for (const asset of takesToUpload(doc, rows, required ? new Set() : refused)) {
        check(token);
        try { await api.uploadTake(beatId, asset, rows.find(r => r.take_ref === asset.ref), { ...token }); check(token); }
        catch (error) {
          check(token); failures.push(asset.name);
          if (['TAKE_CHANGED', 'LIMIT_REACHED', 'TAKE_UNAVAILABLE'].includes(errorCode(error))) refused.add(asset.ref);
        }
      }
      rows = await rowsFor(token);
      const missing = takesToUpload(doc, rows);
      setView(v => ({ ...v, media: missing.map(a => a.name) }));
      clearTimeout(mediaTimer);
      if (!required && missing.some(a => !refused.has(a.ref))) mediaTimer = setTimeout(() => void cycle(), 60000);
      if (required && missing.length) throw Object.assign(new Error(`Could not save these takes to your account: ${missing.map(a => a.name).join(', ')}. Retry or Keep mine.`), { code: 'MEDIA_REQUIRED', names: failures });
    }
    async function getTheirs(token) {
      const result = await api.getCloudBeat(beatId, token); check(token);
      const doc = JSON.parse(result.doc_json);
      if (!validateBeat(doc).ok || doc.id !== beatId) throw new Error('Invalid account beat');
      conflict = { doc: migrateBeat(doc), revision: result.project.revision, projectId: result.project.id, token };
      paused = false; pending = null; show('conflict');
    }
    async function write(record, token, mode, expected) {
      const body = saveRequest(record.doc, expected ?? record.cloud.revision, mode);
      const signature = JSON.stringify(body);
      if (!pending || pending.signature !== signature) pending = { signature, key: crypto.randomUUID() };
      const result = await api.saveCloudBeat(beatId, body, pending.key, token); check(token);
      pending = null;
      if (mode !== 'stash') {
        const link = { userId: token.userId, projectId: result.project.id, revision: result.project.revision, syncedUpdatedAt: record.doc.updatedAt };
        const saved = await store.setCloudLink(beatId, record.cloud, link); check(token);
        if (saved.error) throw Object.assign(new Error('Local link changed'), { code: 'LOCAL_CONFLICT' });
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
        if (!maySync(record.cloud, userId)) { show(record.cloud ? 'other' : 'unlinked'); return; }
        const save = mode === 'checkpoint' || needsSync(record, userId, syncedLocalRevision);
        if (lifecycle && (!save || new TextEncoder().encode(JSON.stringify(saveRequest(record.doc, record.cloud.revision, mode))).length > 64000)) return;
        show('syncing');
        if (save) await write(record, { ...token, keepalive: lifecycle }, mode);
        if (!lifecycle) await media(record.doc, token);
        check(token); attempt = 0; retryAt = 0; show('synced');
        const fresh = await store.getBeat(beatId); check(token);
        if (fresh.record && needsSync(fresh.record, userId, syncedLocalRevision)) schedule();
      } catch (error) {
        if (!current(token)) return;
        const next = errorState(error);
        if (next === 'conflict') {
          try { await getTheirs(token); } catch { if (current(token)) { show('offline'); retryAt = Date.now() + 10000; schedule(); } }
        } else {
          show(next); const delay = retryDelay(attempt++, error);
          if (delay === null) terminal = true;
          else { retryAt = Date.now() + delay; schedule(delay); }
        }
      } finally { if (current(token)) { busy = false; setView(v => ({ ...v, busy: false })); } }
    }
    async function link() {
      if (!userId || busy) return;
      const token = capture(), { record } = await store.getBeat(beatId); check(token);
      if (!record || record.cloud) return;
      const result = await store.setCloudLink(beatId, null, { userId, projectId: null, revision: 0, syncedUpdatedAt: 0 }); check(token);
      if (result.error) { show('error'); return; }
      terminal = false; await cycle();
    }
    async function resolve(choice) {
      if (!conflict || busy) return;
      const theirs = conflict, token = theirs.token; check(token); busy = true; show('conflict', { detail: '' });
      try {
        if (choice === 'mine') {
          await latest.current.flushLatest(); check(token);
          const { record } = await store.getBeat(beatId); check(token);
          if (!maySync(record?.cloud, token.userId)) throw new Error('Local link changed');
          await write(record, token, 'checkpoint', theirs.revision);
          await media(record.doc, token);
        } else {
          await latest.current.replaceFromCloud(theirs.doc, theirs.revision,
            async doc => {
              const { record } = await store.getBeat(beatId); check(token);
              await write({ ...record, doc }, token, 'stash', theirs.revision);
            }, doc => media(doc, token, true), () => current(token), theirs.projectId);
        }
        check(token); conflict = null; paused = false; show('synced'); schedule();
      } catch (error) {
        if (!current(token)) return;
        if (errorCode(error) === 'VERSION_CONFLICT') {
          try { await getTheirs(token); } catch { if (current(token)) show('conflict', { detail: 'Could not load the latest account version. Retry.' }); }
        }
        else show('conflict', { detail: errorCode(error) === 'MEDIA_REQUIRED' ? error.message : 'Your beat is still on this device. Retry or Keep mine.' });
      } finally { if (current(token)) { busy = false; setView(v => ({ ...v, busy: false })); } }
    }
    function session() {
      const next = getStoredUserId(); if (next === userId) return;
      generation++; controller.abort(); controller = new AbortController();
      clearTimeout(timer); clearTimeout(mediaTimer); firstQueued = 0; busy = false; conflict = null; paused = false;
      pending = null; syncedLocalRevision = null; refused = new Set(); takeRows = []; terminal = false; retryAt = 0; userId = next;
      configureCloudTakes(null); show(userId ? 'unlinked' : 'signed_out', { media: [], detail: '' });
      if (userId) schedule(0);
    }
    const unsubscribe = onSessionChange(session);
    const hidden = () => { if (document.hidden) void cycle('autosave', true); };
    const hide = () => void cycle('autosave', true);
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', hide);
    control.current = { queue: schedule, link: () => link().catch(error => { if (active && errorCode(error) !== 'ACCOUNT_CHANGED') show('error'); }), resolve, checkpoint: () => cycle('checkpoint'),
      retry: () => { terminal = false; retryAt = 0; paused = false; if (conflict) show('conflict'); else void cycle(); },
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
      active = false; generation++; controller.abort(); clearTimeout(timer); clearTimeout(mediaTimer); unsubscribe();
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', hide);
      configureCloudTakes(null); control.current = null;
    };
  }, [beatId, cloud, announce]);
  useEffect(() => { if (project.saved) control.current?.queue(); }, [project.saved]);
  return { ...view, message: messages[view.state], link: () => control.current?.link(), retry: () => control.current?.retry(),
    resolve: choice => control.current?.resolve(choice), later: () => control.current?.later(), checkpoint: () => control.current?.checkpoint(),
    options: () => control.current?.options(), current: token => control.current?.current(token) };
}
