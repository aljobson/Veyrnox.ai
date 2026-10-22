'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient';
import { gatewayFetch, makeIdempotencyKey } from '../../_lib/gateway';
import { filmStudioStore } from '../../_lib/filmStudioStore';
import { parseFilm, MAX_FILM_BYTES } from '../../_lib/filmStudioStorage';
import { parseSavedFilms, saveRequest, removeRequest, openPath, acceptSaveResult, mergeSavedProject, unlinkPatch, isNewerThanSaved, parseCloudParam, cloudErrorKey, saveFailureKeys } from '../../_lib/filmStudioCloud';
import { ConfirmDialog } from '../ConfirmDialog';

// A message is the translation keys to show, in order, and whether it is an error.
const notice = (error, ...keys) => ({ keys, error });

export function FilmCloud({ state, replaceFilm, persist }) {
  const { t, locale } = useI18n();
  const userId = state.userId;
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const listRef = useRef(null);
  const locked = useRef(false);
  const alive = useRef(false);
  const epoch = useRef(0);
  const reloadPending = useRef(false);
  const confirmResolve = useRef(null);
  const reloadRef = useRef(null);
  const number = n => locale === 'en' ? String(n) : Number(n).toLocaleString(localeTag(locale));
  const date = value => new Date(value).toLocaleDateString(localeTag(locale), { year: 'numeric', month: 'short', day: 'numeric' });
  const current = token => alive.current && epoch.current === token && getStoredUserId() === userId && filmStudioStore.getState().userId === userId;
  const installList = next => { listRef.current = next; setList(next); };
  const begin = () => {
    if (locked.current || !current(epoch.current)) return false;
    locked.current = true; setBusy(true); return true;
  };
  const finish = () => {
    locked.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (reloadPending.current) { reloadPending.current = false; void reloadRef.current(); }
  };
  async function reload() {
    if (!begin()) { if (alive.current) reloadPending.current = true; return; }
    const token = epoch.current;
    try {
      const rows = parseSavedFilms(await gatewayFetch('/film-studio'));
      if (current(token)) installList(rows ? { userId, rows } : null);
    } catch { if (current(token)) installList(null); }
    finally { finish(); }
  }
  useEffect(() => {
    alive.current = true;
    reloadRef.current = reload;
    void reload();
    let observed = getStoredUserId();
    const stop = onSessionChange(() => {
      const next = getStoredUserId();
      if (observed !== next) epoch.current += 1;
      observed = next;
      installList(null); setMessage(null); setConflict(null); setDismissed(false);
      confirmResolve.current?.(false); confirmResolve.current = null; setDialog(null);
      if (next === userId) void reloadRef.current();
    });
    return () => { alive.current = false; epoch.current += 1; stop(); confirmResolve.current?.(false); };
    // The panel is keyed by account. The refs serialize requests across session refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  const ask = options => new Promise(resolve => { confirmResolve.current = resolve; setDialog(options); });
  const answer = value => { const resolve = confirmResolve.current; confirmResolve.current = null; setDialog(null); resolve?.(value); };
  const failure = (key, err) => {
    const keys = saveFailureKeys(filmStudioStore.getState(), err);
    setMessage({ keys: [key, ...keys.slice(1)], seconds: Number.isFinite(err?.retryAfter) ? Math.max(1, err.retryAfter) : 60, error: true });
  };
  function unlink(id) {
    const latest = filmStudioStore.getState();
    if (latest.userId !== userId || getStoredUserId() !== userId) return;
    const patch = unlinkPatch(latest, id);
    if (patch) { filmStudioStore.set(patch); return persist({ linkOnly: true }); }
    return true;
  }
  async function save(asNew = false) {
    if (!begin()) return;
    const token = epoch.current;
    const latest = filmStudioStore.getState();
    const captured = { userId, generation: latest.generation, text: JSON.stringify(latest.film) };
    setMessage(null); setConflict(null);
    try {
      if (new TextEncoder().encode(captured.text).length > MAX_FILM_BYTES) { failure('app.film.cloud.tooLarge'); return; }
      const request = saveRequest({ ...latest, cloud: asNew ? null : latest.cloud, sessionUserId: getStoredUserId() });
      if (!request) {
        if (latest.cloud) unlink(latest.cloud.id);
        setConflict({ id: null }); failure('app.film.cloud.removedElsewhere'); return;
      }
      const key = makeIdempotencyKey();
      const send = () => gatewayFetch(request.path, { method: request.method, body: JSON.stringify(request.body), headers: { 'Idempotency-Key': key } });
      let body;
      try { body = await send(); }
      catch (err) {
        if (!current(token) || !(err?.code === 'network_error' || err?.status >= 500)) throw err;
        body = await send(); // One retry of this click, with the exact same key and snapshot.
      }
      if (!current(token)) return;
      if (!parseSavedFilms({ projects: [body?.project] })?.length) throw new Error('bad response');
      installList(mergeSavedProject(listRef.current || { userId, rows: [] }, body.project, userId));
      reloadPending.current = true;
      const patch = acceptSaveResult(filmStudioStore.getState(), captured, body.project);
      if (patch) {
        filmStudioStore.set(patch);
        if (!persist()) failure('app.film.cloud.failed');
      }
    } catch (err) {
      if (!current(token) || filmStudioStore.getState().generation !== captured.generation) return;
      const key = cloudErrorKey(err);
      if (!asNew && latest.cloud && key === 'app.film.cloud.conflict') setConflict({ id: latest.cloud.id });
      if (!asNew && latest.cloud && key === 'app.film.cloud.removedElsewhere') { unlink(latest.cloud.id); setConflict({ id: null }); }
      failure(key, err);
    } finally { finish(); }
  }
  async function open(row) {
    if (!openPath(row.id) || !begin()) return;
    const token = epoch.current;
    setMessage(null);
    try {
      const film = filmStudioStore.getState().film;
      if ((film.name || film.script || film.shots.length) && !await ask({ kind: 'open', name: row.name })) return;
      if (!current(token)) return;
      const body = await gatewayFetch(openPath(row.id));
      if (!current(token)) return;
      const project = parseSavedFilms({ projects: [body?.project] })?.[0];
      if (!project || project.id !== row.id) throw new Error('bad response');
      const next = parseFilm(body.studio_json);
      if (!current(token)) return;
      replaceFilm(next, { userId, id: project.id, revision: project.revision, savedText: body.studio_json });
      setConflict(null); setDismissed(true);
      if (!filmStudioStore.getState().saved) failure('app.film.cloud.openFailed');
      else { const opened = notice(false, 'app.film.cloud.opened'); setMessage(opened); }
    } catch { if (current(token)) failure('app.film.cloud.openFailed'); }
    finally { finish(); }
  }
  async function remove(row) {
    if (!begin()) return;
    const token = epoch.current;
    setMessage(null);
    try {
      if (!await ask({ kind: 'remove', name: row.name }) || !current(token)) return;
      const request = removeRequest(listRef.current, row, getStoredUserId());
      if (!request) { reloadPending.current = true; return; }
      try {
        const body = await gatewayFetch(request.path, { method: request.method, body: JSON.stringify(request.body) });
        if (!body?.removed && body?.idempotent !== true) throw new Error('bad response');
      } catch (err) { if (cloudErrorKey(err) !== 'app.film.cloud.removedElsewhere') throw err; }
      if (!current(token)) return;
      const localSaved = unlink(row.id);
      const removedNotice = localSaved ? notice(false, 'app.film.cloud.removed') : notice(true, 'app.film.cloud.removed', 'app.film.cloud.exportFirst');
      setMessage(removedNotice);
      reloadPending.current = true;
    } catch (err) {
      if (!current(token)) return;
      const changed = cloudErrorKey(err) === 'app.film.cloud.conflict';
      failure(changed ? 'app.film.cloud.removeChanged' : 'app.film.cloud.removeFailed', err);
      if (changed) reloadPending.current = true;
    } finally { finish(); }
  }
  if (!userId || list?.userId !== userId) return null;
  const handoff = !dismissed && typeof window !== 'undefined' ? parseCloudParam(window.location.search, list.rows) : null;
  const linked = state.cloud?.userId === userId ? state.cloud : null;
  const savedRow = linked && list.rows.find(row => row.id === linked.id);
  const status = !linked ? 'app.film.cloud.localOnly' : isNewerThanSaved(state.film, linked) || !savedRow || savedRow.revision !== linked.revision ? 'app.film.cloud.changed' : 'app.film.cloud.saved';
  const button = 'min-h-11 rounded-full border border-vx-border px-4 py-2 text-sm font-semibold disabled:opacity-40';
  return <section aria-labelledby="film-cloud-heading" className="mt-4 rounded-xl border border-vx-border p-4 [&_button]:min-h-11">
    <h2 id="film-cloud-heading" className="text-lg font-bold">{t('app.film.cloud.heading')}</h2>
    <p role="status" className="mt-2 text-sm">{t(status, { date: savedRow ? date(savedRow.updated_at) : '' })}</p>
    <button type="button" className={button} disabled={busy} aria-busy={busy} onClick={() => save()}>{t('app.film.cloud.save')}</button>
    {busy && <p role="status">{t('app.film.cloud.working')}</p>}
    {message && <div role={message.error ? 'alert' : 'status'}>{message.keys.map(key => <p key={key}>{t(key, { seconds: number(message.seconds) })}</p>)}</div>}
    {conflict && <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy} aria-busy={busy} onClick={() => save(true)}>{t('app.film.cloud.saveNew')}</button>
      {conflict.id && <button type="button" className={button} disabled={busy} aria-busy={busy} onClick={() => open({ id: conflict.id, name: state.film.name })}>{t('app.film.cloud.openAccount')}</button>}
    </div>}
    {handoff && <div><p>{t('app.film.cloud.handoff', { name: handoff.name })}</p>
      <button type="button" className={button} disabled={busy} aria-busy={busy} aria-label={t('app.film.cloud.openName', { name: handoff.name })} onClick={() => open(handoff)}>{t('app.film.cloud.open')}</button>
      <button type="button" className={button} disabled={busy} aria-busy={busy} onClick={() => setDismissed(true)}>{t('app.film.cloud.dismiss')}</button>
    </div>}
    <ul className="mt-3 space-y-3">{list.rows.map(row => <li key={row.id} className="rounded-lg border border-vx-border p-3">
      <p className="font-semibold">{row.name}</p><p className="text-sm">{t('app.film.cloud.details', { count: number(row.shot_count), date: date(row.updated_at) })}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} aria-busy={busy} aria-label={t('app.film.cloud.openName', { name: row.name })} onClick={() => open(row)}>{t('app.film.cloud.open')}</button>
        <button type="button" className={button} disabled={busy} aria-busy={busy} aria-label={t('app.film.cloud.removeName', { name: row.name })} onClick={() => remove(row)}>{t('app.film.cloud.remove')}</button>
      </div>
    </li>)}</ul>
    {dialog && <ConfirmDialog title={t(dialog.kind === 'remove' ? 'app.film.cloud.removeTitle' : 'app.film.cloud.replaceTitle')}
      body={t(dialog.kind === 'remove' ? 'app.film.cloud.removeConfirm' : 'app.film.cloud.replaceConfirm', { name: dialog.name })}
      confirmLabel={t(dialog.kind === 'remove' ? 'app.film.cloud.remove' : 'app.film.cloud.open')} cancelLabel={t('app.film.cloud.cancel')}
      tone={dialog.kind === 'remove' ? 'danger' : 'accent'} onConfirm={() => answer(true)} onCancel={() => answer(false)}/>}
  </section>;
}
