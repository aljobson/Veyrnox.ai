'use client';

import { useEffect, useState } from 'react';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { STUDIO_WORKFLOWS, workflowById } from '../../_lib/studioWorkflows';
import { StudioSkillIcon } from './StudioSkillIcon';
import { StudioWorkflowIcon } from './StudioWorkflowIcon';
import { WorkflowDetailsDialog } from './WorkflowDetailsDialog';

export function WorkflowsPanel() {
  const { t } = useI18n();
  const [detailWorkflow, setDetailWorkflow] = useState(null);

  useEffect(() => {
    const initial = workflowById(new URLSearchParams(window.location.search).get('workflow'));
    if (!initial) return;
    const frame = window.requestAnimationFrame(() => setDetailWorkflow(initial));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <section aria-labelledby="studio-workflows-title" className="mx-auto mt-10 w-full max-w-[960px] text-start">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{t('app.chat.workflows.kicker')}</p>
          <h2 id="studio-workflows-title" className="vx-display mt-2 text-3xl leading-none sm:text-4xl">{t('app.chat.workflows.title')}</h2>
          <p className="mt-2 max-w-2xl text-sm text-vx-fg-muted">{t('app.chat.workflows.help')}</p>
        </div>
        <span className="rounded-full border border-vx-border px-3 py-1.5 font-vx-mono text-[10px] uppercase text-vx-fg-muted">{t('app.chat.workflows.control')}</span>
      </div>

      <ul className="mt-5 grid gap-3 md:grid-cols-2">
        {STUDIO_WORKFLOWS.map((workflow) => (
          <li key={workflow.id}>
            <button type="button" onClick={() => setDetailWorkflow(workflow)} className="group flex h-full w-full flex-col rounded-2xl border border-vx-border bg-vx-panel p-5 text-start transition hover:-translate-y-0.5 hover:border-vx-accent hover:shadow-xl">
              <span className="flex w-full items-start gap-4">
                <StudioWorkflowIcon workflow={workflow} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-base font-bold">{tOr(t, `app.chat.workflow.${workflow.id}.name`, workflow.name)}</span>
                    <span className="font-vx-mono text-[10px] uppercase text-vx-fg-muted">{t('app.chat.workflows.steps', { count: workflow.steps.length })}</span>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-vx-fg-muted">{tOr(t, `app.chat.workflow.${workflow.id}.blurb`, workflow.blurb)}</span>
                </span>
              </span>
              <span className="mt-5 flex items-center">
                {workflow.steps.slice(0, 5).map((skillId, index) => (
                  <StudioSkillIcon key={skillId} skillId={skillId} className={index ? '-ml-2' : ''} />
                ))}
                {workflow.steps.length > 5 && <span className="-ml-2 grid size-11 place-items-center rounded-xl border border-vx-border bg-vx-base font-vx-mono text-[10px] text-vx-fg-muted">+{workflow.steps.length - 5}</span>}
                <span className="ml-auto text-xs font-bold text-vx-accent">{t('app.chat.workflows.view')} →</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {detailWorkflow && <WorkflowDetailsDialog workflow={detailWorkflow} onClose={() => setDetailWorkflow(null)} />}
    </section>
  );
}
