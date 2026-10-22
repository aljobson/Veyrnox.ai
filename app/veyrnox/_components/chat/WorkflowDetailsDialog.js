'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { Modal } from '../Modal';
import { workflowStartHref, workflowSteps } from '../../_lib/studioWorkflows';
import { StudioSkillIcon } from './StudioSkillIcon';
import { StudioWorkflowIcon } from './StudioWorkflowIcon';

export function WorkflowDetailsDialog({ workflow, onClose }) {
  const { t } = useI18n();
  const closeRef = useRef(null);
  const steps = workflowSteps(workflow);

  useEffect(() => {
    const url = new URL(window.location.href);
    const skillsPath = url.pathname;
    url.searchParams.set('workflow', workflow.id);
    window.history.replaceState(null, '', url);
    return () => {
      const clean = new URL(window.location.href);
      if (clean.pathname !== skillsPath) return;
      clean.searchParams.delete('workflow');
      window.history.replaceState(null, '', clean);
    };
  }, [workflow.id]);

  return (
    <Modal onCancel={onClose} initialFocusRef={closeRef} aria-labelledby="workflow-detail-title" className="items-end justify-center p-0 sm:items-center sm:p-6">
      <article className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-vx-border bg-vx-base p-5 shadow-2xl sm:rounded-2xl sm:p-7">
        <header className="flex items-start justify-between gap-5 border-b border-vx-border pb-5">
          <div className="flex min-w-0 items-start gap-4 sm:gap-5">
            <StudioWorkflowIcon workflow={workflow} size="detail" />
            <div className="min-w-0">
              <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{t('app.chat.workflows.guided')}</p>
              <h2 id="workflow-detail-title" className="vx-display mt-2 text-[34px] leading-none sm:text-[44px]">{tOr(t, `app.chat.workflow.${workflow.id}.name`, workflow.name)}</h2>
              <p className="mt-3 max-w-[48ch] text-sm leading-6 text-vx-fg-muted">{tOr(t, `app.chat.workflow.${workflow.id}.blurb`, workflow.blurb)}</p>
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('authGate.close')} className="grid size-10 shrink-0 place-items-center rounded-full border border-vx-border text-lg hover:border-vx-accent">×</button>
        </header>

        <section className="py-6">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] text-vx-fg-faint">{t('app.chat.workflows.steps', { count: steps.length })}</h3>
            <p className="text-end text-xs text-vx-fg-muted">{t('app.chat.workflows.approve')}</p>
          </div>
          <ol className="mt-4 space-y-2">
            {steps.map((step, index) => (
              <li key={step.id} className="flex items-center gap-3 rounded-2xl border border-vx-border bg-vx-panel p-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-vx-border font-vx-mono text-[10px] font-bold text-vx-accent">{index + 1}</span>
                <StudioSkillIcon skillId={step.id} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{step.name}</span>
                  <span className="mt-0.5 block text-xs text-vx-fg-muted">{step.blurb}</span>
                </span>
                <Link href={`/app/chat?skill=${encodeURIComponent(step.id)}`} className="shrink-0 rounded-full border border-vx-border px-3 py-1.5 text-[10px] font-bold uppercase hover:border-vx-accent">{t('app.chat.workflows.open')}</Link>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-2xl border border-vx-border bg-vx-panel p-5">
          <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] text-vx-accent">{t('app.chat.workflows.outcome')}</p>
          <p className="mt-2 text-sm leading-6 text-vx-fg-body">{tOr(t, `app.chat.workflow.${workflow.id}.outcome`, workflow.outcome)}</p>
        </section>

        <footer className="mt-6 flex items-center gap-3">
          <Link href={workflowStartHref(workflow)} className="vx-press inline-flex items-center justify-center rounded-full bg-vx-accent px-6 py-3 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover">
            {t('app.chat.workflows.start')} →
          </Link>
          <span className="text-xs text-vx-fg-muted">{t('app.chat.workflows.priceNote')}</span>
        </footer>
      </article>
    </Modal>
  );
}
