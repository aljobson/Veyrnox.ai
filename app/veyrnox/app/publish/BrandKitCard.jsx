'use client';
import { useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { gatewayFetch } from '../../_lib/gateway.js';

import { usePublishBrandKit, useSocialBrandRevision } from './usePublishBrandKit.js';
import { assertSocialBrandSnapshot } from '../../../lib/socialBrandSelection.js';

// ADR-0325: the workspace brand kit linked to the selected Publish brand.
const btn = 'min-h-11 focus-visible:outline focus-visible:outline-vx-accent rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
const HEX = /^#[0-9a-f]{6}$/i;

export default function BrandKitCard() {
  const revision = useSocialBrandRevision();
  return <BrandKitCardContent key={revision} />;
}

function BrandKitCardContent() {
  const { t } = useI18n();
  const state = usePublishBrandKit(true);
  const { workspaces = [], reload: load } = state;
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function change(workspaceId) {
    const snapshot = state.snapshot;
    if (!snapshot || busy) return;
    setBusy(true); setProblem('');
    try {
      await gatewayFetch('/social/brand-kit', { method: 'PUT', body: JSON.stringify({ workspaceId }) }, false, snapshot);
      assertSocialBrandSnapshot(snapshot);
      setChoice('');
      await load();
    } catch {
      try { assertSocialBrandSnapshot(snapshot); } catch { return; }
      setProblem(t('app.publish.brandKit.linkFailed'));
    } finally {
      try { assertSocialBrandSnapshot(snapshot); setBusy(false); } catch { /* Discard old brand completion. */ }
    }
  }

  if (state.status === 'hidden') return null;
  const data = state.data;
  const kit = data?.kit;
  return <section aria-label={t('app.publish.brandKit.title')} className="mb-6 rounded-2xl border border-vx-border p-4 text-sm">
    <h2 className="mb-2 text-base font-black">{t('app.publish.brandKit.title')}</h2>
    {state.status === 'loading' && <p role="status" className="text-vx-fg-muted">{t('app.publish.brandKit.loading')}</p>}
    {state.status === 'error' && <div role="alert"><p className="mb-2">{t('app.publish.brandKit.failed')}</p><button type="button" className={btn} onClick={load}>{t('app.publish.brandKit.retry')}</button></div>}
    {data && !data.linked && <p className="text-vx-fg-muted">{data.canLink ? t('app.publish.brandKit.notLinked') : t('app.publish.brandKit.notLinkedMember')}</p>}
    {data?.linked && data.empty && <p className="text-vx-fg-muted">{data.workspaceName ? t('app.publish.brandKit.empty', { workspace: data.workspaceName }) : t('app.publish.brandKit.emptyMember')}</p>}
    {kit && <div className="space-y-3">
      <p className="font-bold">{kit.name} {data.workspaceName && <span className="font-normal text-vx-fg-muted">· {t('app.publish.brandKit.from', { workspace: data.workspaceName })}</span>}</p>
      {kit.voice && <p>{kit.voice}</p>}
      {kit.hashtags?.length > 0 && <p>{kit.hashtags.map(tag => `#${tag}`).join(' ')}</p>}
      {kit.hasLogo && <p>{t('app.publish.brandKit.hasLogo')}</p>}
      <div><p className="mb-1 text-xs font-bold text-vx-fg-muted">{t('app.publish.brandKit.palette')}</p>
        <ul className="flex flex-wrap gap-1">{kit.palette.filter((c) => HEX.test(c)).map((c, i) => <li key={`${c}:${i}`} role="img" aria-label={t('app.publish.brandKit.swatch', { colour: c })} title={c} className="size-7 rounded border border-vx-border" style={{ background: c }} />)}</ul></div>
      <p><span className="text-xs font-bold text-vx-fg-muted">{t('app.publish.brandKit.fonts')}: </span>{kit.fonts.join(', ')}</p>
      {kit.textStyles.length > 0 && <p><span className="text-xs font-bold text-vx-fg-muted">{t('app.publish.brandKit.styles')}: </span>{kit.textStyles.map((s) => s.name).join(', ')}</p>}
      {kit.credits.length > 0 && <div><p className="mb-1 text-xs font-bold text-vx-fg-muted">{t('app.publish.brandKit.credits')}</p>
        <ul className="space-y-1">{kit.credits.map((c, i) => <li key={i}>{c.name}{c.credit && ` · ${c.credit}`}{c.usage && ` · ${c.usage}`}{/^https:\/\//.test(c.url) && <>{' · '}<a href={c.url} target="_blank" rel="noopener noreferrer" className="underline">{t('app.publish.brandKit.licence')}</a></>}</li>)}</ul></div>}
    </div>}
    {data?.canLink && <div className="mt-3 flex flex-wrap items-end gap-2">
      {workspaces.length === 0 ? <p className="text-vx-fg-muted">{t('app.publish.brandKit.noWorkspaces')}</p> : <>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t('app.publish.brandKit.workspace')}
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className="rounded-xl border border-vx-border bg-vx-panel px-3 py-2 text-sm text-vx-fg">
            <option value="">{t('app.publish.brandKit.choose')}</option>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>
        <button type="button" className={btn} disabled={busy || !choice} onClick={() => change(choice)}>{t('app.publish.brandKit.link')}</button></>}
      {data.linked && <button type="button" className={btn} disabled={busy} onClick={() => change(null)}>{t('app.publish.brandKit.unlink')}</button>}
    </div>}
    {problem && <p role="alert" className="mt-2">{problem}</p>}
  </section>;
}
