'use client';
import { tOr, pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { parseStudioDrafts } from '../../_lib/studioSkills';
import { stageChatStudioDraft } from '../../_lib/chatStudioDraft';
import { CopyButton } from '../CopyButton';



/**
 * An Open in Studio card for each Studio draft in an assistant reply (ADR-0073). A draft is checked against the live catalog
 * first, so only a model the Studio sells can be offered, and its price is the catalog's. Opening it fills the Studio's prompt
 * through the same sessionStorage hand-off the landing page uses; nothing is charged until the person presses Generate there.
 */
export function StudioDraftCards({ text, models, oddlingHandoff = null }) {
  const { t, locale } = useI18n();
  const credits = count => t(pluralKey(t, locale, 'app.chat.price', count), { count: locale === 'en' ? count : count.toLocaleString(localeTag(locale)) });
  const router = useRouter();
  const [failedDraft, setFailedDraft] = useState(-1);
  const drafts = parseStudioDrafts(text, models);
  if (drafts.length === 0) return null;
  const open = (d, index) => {
    const destination = stageChatStudioDraft(window.sessionStorage, d, oddlingHandoff);
    if (!destination) { setFailedDraft(index); return; }
    setFailedDraft(-1);
    router.push(destination);
  };
  return (
    <ul className="mt-3 grid gap-2" aria-label={t("app.chat.drafts.label")}>
      {drafts.map((d, i) => (
        <li key={`${d.model}-${i}`} className="flex flex-col gap-2 rounded-xl border border-vx-border bg-vx-panel p-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0 text-sm">
            <span className="block font-semibold">{drafts.length > 1 ? t('app.chat.drafts.shot', { count: locale === 'en' ? i + 1 : (i + 1).toLocaleString(localeTag(locale)) }) : ''}{d.name} <span className="font-vx-mono text-xs text-vx-money vx-num">{credits(d.credits)}</span></span>
            <span className="block truncate text-vx-fg-muted">{d.prompt}</span>
            {d.needs.length > 0 && <span className="block text-xs text-vx-fg-muted">{t('app.chat.drafts.needs', { needs: d.needs.map(slot => tOr(t, `public.library.${slot}`, slot)).join(t('app.chat.drafts.and')) })}</span>}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-2">
            <button type="button" onClick={() => open(d, i)} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-semibold text-vx-accent-ink">{t("app.film.output.open")}</button>
            {failedDraft === i && (
              <span role="alert" className="max-w-64 text-end text-xs leading-5 text-vx-danger">
                {t('app.chat.drafts.handoffFailed')}{' '}
                <CopyButton value={d.prompt} label={t('app.chat.drafts.copyPrompt')} className="ms-1" />
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
