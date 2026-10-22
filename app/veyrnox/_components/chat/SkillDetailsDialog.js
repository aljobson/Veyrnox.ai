'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { CopyButton } from '../CopyButton';
import { Modal } from '../Modal';
import { skillOverview } from '../../_lib/studioSkills';
import { StudioSkillIcon } from './StudioSkillIcon';
import { tOr } from '../../../../lib/i18n/translate.mjs';

export function SkillDetailsDialog({ skill, onClose }) {
  const { t } = useI18n();
  const closeRef = useRef(null);
  const overview = skillOverview(skill);
  const title = tOr(t, `app.chat.skill.${skill.id}.name`, skill.name);
  const introduction = tOr(t, `app.chat.skill.${skill.id}.blurb`, overview.introduction);
  const bestFor = tOr(t, `app.chat.skill.${skill.id}.bestFor`, overview.bestFor);
  const output = tOr(t, `app.chat.skill.${skill.id}.output`, overview.output);
  const howTo = overview.howTo.map((step, index) => index === 0
    ? tOr(t, `app.chat.skill.${skill.id}.starter`, step)
    : tOr(t, index === 1 ? 'app.chat.skillDetails.howMissing' : skill.group === 'Film' ? 'app.chat.skillDetails.howFilm' : 'app.chat.skillDetails.howStudio', step));
  const relativeHref = `/app/skills?skill=${encodeURIComponent(skill.id)}`;
  const [shareHref, setShareHref] = useState(relativeHref);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShareHref(`${window.location.origin}${relativeHref}`));
    const url = new URL(window.location.href);
    const skillsPath = url.pathname;
    url.searchParams.set('skill', skill.id);
    window.history.replaceState(null, '', url);
    return () => {
      window.cancelAnimationFrame(frame);
      const clean = new URL(window.location.href);
      // A link to Chat also carries `skill`; do not erase it while this sheet
      // unmounts as the route changes.
      if (clean.pathname !== skillsPath) return;
      clean.searchParams.delete('skill');
      window.history.replaceState(null, '', clean);
    };
  }, [relativeHref, skill.id]);

  return (
    <Modal onCancel={onClose} initialFocusRef={closeRef} aria-labelledby="skill-detail-title" className="items-end justify-center p-0 sm:items-center sm:p-6">
      <article className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-vx-border bg-vx-base p-5 shadow-2xl sm:rounded-2xl sm:p-7">
        <header className="flex items-start justify-between gap-5 border-b border-vx-border pb-5">
          <div className="flex min-w-0 items-start gap-4 sm:gap-5">
            <StudioSkillIcon skillId={skill.id} size="detail" className="mt-0.5" />
            <div className="min-w-0">
            <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{t('app.chat.skills.title')}</p>
            <h2 id="skill-detail-title" className="vx-display mt-2 text-[34px] leading-none sm:text-[44px]">{title}</h2>
            <p className="mt-3 max-w-[50ch] text-sm leading-6 text-vx-fg-muted">{introduction}</p>
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('authGate.close')} className="grid size-10 shrink-0 place-items-center rounded-full border border-vx-border text-lg hover:border-vx-accent">×</button>
        </header>

        <div className="grid gap-6 py-6 sm:grid-cols-2">
          <section>
            <h3 className="font-vx-mono text-[10px] font-bold tracking-[0.12em] text-vx-fg-faint">{t('app.chat.skillDetails.bestFor')}</h3>
            <p className="mt-2 text-sm leading-6 text-vx-fg-body">{bestFor}</p>
          </section>
          <section>
            <h3 className="font-vx-mono text-[10px] font-bold tracking-[0.12em] text-vx-fg-faint">{t('app.chat.skillDetails.output')}</h3>
            <p className="mt-2 text-sm leading-6 text-vx-fg-body">{output}</p>
          </section>
        </div>

        <section className="rounded-2xl border border-vx-border bg-vx-panel p-5">
          <h3 className="font-vx-mono text-[10px] font-bold tracking-[0.12em] text-vx-accent">{t('app.film.workspace.how')}</h3>
          <ol className="mt-4 space-y-4">
            {howTo.map((step, index) => (
              <li key={step} className="flex gap-3 text-sm leading-6 text-vx-fg-body">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-vx-border font-vx-mono text-[10px] font-bold text-vx-accent">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <footer className="mt-6 flex flex-wrap items-center gap-3">
          <Link href={`/app/chat?skill=${encodeURIComponent(skill.id)}`} className="vx-press inline-flex flex-1 items-center justify-center rounded-full bg-vx-accent px-6 py-3 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover sm:flex-none">
            {t('app.chat.skillDetails.use')} →
          </Link>
          <CopyButton value={shareHref} label={t('common.copy')} copiedLabel={t('common.copied')} className="px-4 py-2.5 text-[10px]" />
          <span className="w-full text-xs text-vx-fg-muted sm:ml-auto sm:w-auto">{t('app.chat.skillDetails.priceNote')}</span>
        </footer>
      </article>
    </Modal>
  );
}
