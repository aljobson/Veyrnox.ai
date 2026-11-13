'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { Button } from '../../_components/Button';
import { BrandKitPanel } from '../../_components/editor/BrandKitPanel';
import { useProjectsEnabled } from '../../_components/ProjectsFlag';
import { gatewayFetch } from '../../_lib/gateway';

export default function BrandKitPage() {
  const { t } = useI18n();
  const enabled = useProjectsEnabled();
  const [workspaces, setWorkspaces] = useState(null);
  const [selected, setSelected] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    gatewayFetch('/workspaces', { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setFailed(false);
        setWorkspaces(result.workspaces);
        setSelected(current => result.workspaces.find(w => w.id === current)?.id || result.workspaces[0]?.id || '');
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [enabled, attempt]);

  return <>
    <AppNav active="brandKit" />
    <Main className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
      <h1 className="text-3xl font-black sm:text-4xl">{t('app.editor.rail.brand')}</h1>
      <p className="mt-3 mb-6 max-w-lg text-sm text-vx-fg-muted">{t('app.brandKit.page.intro')}</p>
      {failed && <div role="alert" className="space-y-2 text-sm">
        <p>{t('app.editor.brand.loadFailed')}</p>
        <Button type="button" className="min-h-11" size="sm" onClick={() => setAttempt(n => n + 1)}>{t('app.editor.brand.retry')}</Button>
      </div>}
      {!failed && !workspaces && <p role="status" className="text-sm">{t('app.editor.brand.loading')}</p>}
      {workspaces && workspaces.length === 0 && <p role="status" className="text-sm">{t('app.brandKit.page.noWorkspace')}</p>}
      {workspaces?.length > 1 && <label className="mb-4 block text-sm">{t('app.brandKit.page.workspace')}
        <select className="mt-1 block w-full rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-sm text-vx-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent"
          value={selected} onChange={e => setSelected(e.target.value)}>
          {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </label>}
      {selected && <BrandKitPanel key={selected} project={{ workspaceId: selected }} item={null} frame={0} disabled={false} />}
    </Main>
  </>;
}
