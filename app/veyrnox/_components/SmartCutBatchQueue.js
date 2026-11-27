'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { Button } from './Button';
import { cancelSmartCutBatchItem, createSmartCutBatch, failSmartCutBatchItem, finishSmartCutBatchItem, nextSmartCutBatchItem, openSmartCutBatchItem, readSmartCutBatch, removeSmartCutBatch, retrySmartCutBatchItem, smartCutBatchDone, writeSmartCutBatch } from '../_lib/smartCutBatchQueue.mjs';

const storage = () => { try { return window.localStorage; } catch { return null; } };
export function SmartCutBatchQueue({ workspaceId, projects }) {
  const { t } = useI18n();
  const [actor, setActor] = useState(() => getStoredUserId() || '');
  const [selected, setSelected] = useState([]);
  const [queue, setQueue] = useState(null);
  const [storageProblem, setStorageProblem] = useState('');
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => onSessionChange((session) => { setActor(session?.user?.id || ''); setSelected([]); setStorageProblem(''); }), []);
  useEffect(() => { setQueue(workspaceId && actor ? readSmartCutBatch(storage(), actor, workspaceId) : null); setSelected([]); setStorageProblem(''); }, [actor, workspaceId]);
  const persist = (next) => {
    if (!live.current || !next) return false;
    if (!writeSmartCutBatch(storage(), next)) { setStorageProblem(t('app.projects.smartCutBatch.saveFailed')); return false; }
    setQueue(next); setStorageProblem(''); return true;
  };
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length >= 10 ? current : [...current, id]);
  const start = () => {
    if (!actor) return;
    const next = createSmartCutBatch({ owner: actor, workspaceId, projects: projects.filter((project) => selected.includes(project.id)), id: crypto.randomUUID() });
    if (next && persist(next)) setSelected([]);
  };
  const open = (item) => {
    const next = openSmartCutBatchItem(queue, item.projectId);
    if (persist(next) && next.items.find((row) => row.projectId === item.projectId)?.state === 'active') window.location.assign(`/app/editor?project=${encodeURIComponent(item.projectId)}&smartCutBatch=${encodeURIComponent(next.id)}`);
  };
  const clear = () => {
    if (!removeSmartCutBatch(storage(), actor, workspaceId)) { setStorageProblem(t('app.projects.smartCutBatch.saveFailed')); return; }
    setQueue(null); setSelected([]); setStorageProblem('');
  };
  const pending = queue && !smartCutBatchDone(queue);
  const next = queue ? nextSmartCutBatchItem(queue) : null;
  return <section data-testid="smart-cut-batch" className="mb-5 rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-4" aria-labelledby="smart-cut-batch-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-vx-mono text-[10px] font-bold uppercase tracking-widest text-vx-accent">{t('app.projects.smartCutBatch.eyebrow')}</p><h2 id="smart-cut-batch-title" className="mt-1 font-black">{t('app.projects.smartCutBatch.title')}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-vx-fg-muted">{t('app.projects.smartCutBatch.help')}</p></div>
      {queue ? <Button size="sm" variant="ghost" onClick={clear}>{t(smartCutBatchDone(queue) ? 'app.projects.smartCutBatch.clear' : 'app.projects.smartCutBatch.discard')}</Button> : null}</div>
    {storageProblem ? <p role="alert" className="mt-3 text-xs font-bold text-vx-danger">{storageProblem}</p> : null}
    {!queue ? <><div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('app.projects.smartCutBatch.group')}>{projects.map((project) => <button type="button" key={project.id} aria-pressed={selected.includes(project.id)} onClick={() => toggle(project.id)} className="min-h-11 rounded-full border border-vx-border px-3 text-xs font-bold aria-pressed:border-vx-accent aria-pressed:bg-vx-accent aria-pressed:text-vx-accent-ink">{selected.includes(project.id) ? '✓ ' : ''}{project.name}</button>)}</div>
      <Button className="mt-3" size="sm" disabled={!actor || selected.length < 2} onClick={start}>{t('app.projects.smartCutBatch.create', { count: selected.length })}</Button></>
      : <><p role="status" className="mt-3 text-xs font-semibold text-vx-fg-muted">{t('app.projects.smartCutBatch.progress', { done: queue.items.filter((item) => item.state === 'completed').length, total: queue.items.length })}{next ? ` · ${t('app.projects.smartCutBatch.next', { name: next.name || t('app.projects.untitledProject') })}` : ''}</p>
        <ol className="mt-3 grid gap-2">{queue.items.map((item) => <li key={item.projectId} className="flex flex-wrap items-center gap-2 rounded-xl border border-vx-border bg-vx-base p-3"><span className="min-w-0 flex-1 text-sm font-bold">{item.name || t('app.projects.untitledProject')}</span><span className="text-xs uppercase text-vx-fg-muted">{t(`app.projects.smartCutBatch.state.${item.state}`)}</span>
          {item.state === 'pending' ? <><Button size="sm" onClick={() => open(item)} disabled={queue.items.some((row) => row.state === 'active')}>{t('app.projects.smartCutBatch.open')}</Button><Button size="sm" variant="ghost" onClick={() => persist(cancelSmartCutBatchItem(queue, item.projectId))}>{t('app.projects.smartCutBatch.cancel')}</Button></> : null}
          {item.state === 'active' ? <><Button size="sm" onClick={() => persist(finishSmartCutBatchItem(queue, item.projectId))}>{t('app.projects.smartCutBatch.complete')}</Button><Button size="sm" variant="ghost" onClick={() => persist(failSmartCutBatchItem(queue, item.projectId, 'retry_requested'))}>{t('app.projects.smartCutBatch.fail')}</Button></> : null}
          {item.state === 'failed' ? <Button size="sm" onClick={() => persist(retrySmartCutBatchItem(queue, item.projectId))}>{t('app.projects.smartCutBatch.retry')}</Button> : null}
        </li>)}</ol>{!pending ? <p className="mt-3 text-sm font-bold text-vx-accent">{t('app.projects.smartCutBatch.done')}</p> : null}</>}
  </section>;
}
