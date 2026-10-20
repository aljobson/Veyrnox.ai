'use client';
import LegalLink from '../../../../components/LegalLink';
import { useI18n } from '../../../../components/I18nProvider';

import { pluralKey, tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  editorCreditPacks,
  FREE_EDITOR_BENEFITS,
} from '../../_lib/editorCredits.mjs';
import { Logo } from '../Logo';

const usdFor = locale => new Intl.NumberFormat(localeTag(locale, 'en-US'), {
  style: 'currency',
  currency: 'USD',
  trailingZeroDisplay: 'stripIfInteger',
});


async function publicPacks() {
  const response = await fetch('/api/credit-packs', { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || 'packs_unavailable');
  return body;
}

const BENEFIT_IDS = {
  "Full multitrack video editor": "multitrack",
  "Local preview and export": "local",
  "Cloud projects and version history": "cloud",
  "No card required": "no_card"
};

function BenefitList({ items }) {
  const { t } = useI18n();
  return (
    <ul className="grid gap-3 text-sm text-vx-fg-body sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <li key={item} className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-5 shrink-0 place-items-center rounded-full bg-vx-accent/15 text-xs font-black text-vx-accent"
          >
            ✓
          </span>
          <span>{tOr(t, `app.editor.credits.benefit.${BENEFIT_IDS[item]}`, item)}</span>
        </li>
      ))}
    </ul>
  );
}

function PackCard({ pack }) {
  const { t, locale } = useI18n();
  const usd = usdFor(locale), credits = new Intl.NumberFormat(localeTag(locale, 'en-US'));
  return (
    <article className="flex min-h-[245px] flex-col rounded-2xl border border-vx-border bg-vx-panel/55 p-5 transition-colors hover:border-vx-money/70">
      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-vx-fg-muted">{t("app.editor.credits.pack")}</p>
      <p className="mt-4 font-vx-mono text-4xl font-black tracking-[-0.05em] text-vx-money">
        {credits.format(pack.credits)}
        <span className="ms-2 text-lg text-vx-fg-muted">cr</span>
      </p>
      <div className="vx-perf mt-5" aria-hidden />
      <p className="mt-4 text-sm text-vx-fg-body">
        {t(pluralKey(t, locale, 'app.editor.credits.amount', pack.credits), {count: credits.format(pack.credits)})}
        <strong>{usd.format(pack.price_usd_cents / 100)}</strong>{' '}{t("app.credits.packs.tax")}</p>
      <p className="mt-2 text-xs font-bold text-vx-fg-muted">{t("app.editor.credits.once")}</p>
      <Link
        href="/app/credits#credit-packs"
        className="mt-auto inline-flex w-full items-center justify-center rounded-full bg-vx-money px-4 py-3 text-sm font-black text-vx-money-ink transition-[filter,scale] hover:brightness-110 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent"
      >
        {t(pluralKey(t, locale, 'app.editor.credits.buy', pack.credits), {count: credits.format(pack.credits)})}
      </Link>
    </article>
  );
}

export function EditorCreditsDialog({ open, onClose }) {
  const { t, locale } = useI18n();
  const closeRef = useRef(null);
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');

  const packs = useMemo(
    () => editorCreditPacks(catalog?.packs),
    [catalog],
  );

  const load = useCallback(async () => {
    setError('');
    try {
      setCatalog(await publicPacks());
    } catch {
      setCatalog(null);
      setError(t("app.editor.credits.failed"));
    }
  }, [t]);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const loadTimer = window.setTimeout(() => void load(), 0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.clearTimeout(loadTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [load, onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] overflow-y-auto bg-black/75 px-3 py-4 backdrop-blur-sm sm:px-6 sm:py-8"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-credits-title"
        className="mx-auto w-full max-w-[1240px] overflow-hidden rounded-[28px] border border-vx-border bg-vx-base shadow-2xl"
      >
        <header className="flex items-center gap-4 border-b border-vx-border px-5 py-4 sm:px-7">
          <Logo wordmark />
          <span className="rounded-full bg-vx-panel px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-vx-fg-muted">{t("app.editor.credits.title")}</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ms-auto grid size-10 place-items-center rounded-full border border-vx-border text-xl hover:border-vx-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent"
            aria-label={t("app.editor.credits.close")}
          >
            ×
          </button>
        </header>

        <div className="px-5 py-7 sm:px-7 sm:py-9">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-vx-accent">{t("app.editor.credits.included")}</p>
            <h2
              id="editor-credits-title"
              className="mt-2 text-3xl font-black tracking-[-0.04em] sm:text-5xl"
            >{t("app.editor.credits.heading")}</h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-vx-fg-body sm:text-base">{t("app.editor.credits.explanation")}</p>
          </div>

          <section className="mt-8 rounded-2xl border border-vx-accent/45 bg-vx-accent/[0.06] p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-vx-accent">{t("app.editor.credits.includedLabel")}</p>
                <h3 className="mt-1 text-2xl font-black">{t("app.editor.credits.brand")}</h3>
              </div>
              <p className="font-vx-mono text-2xl font-black">{usdFor(locale).format(0)}</p>
            </div>
            <BenefitList items={FREE_EDITOR_BENEFITS} />
          </section>

          <div className="mt-9 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-2xl font-black">{t("pricing.packs.title")}</h3>
              <p className="mt-1 text-sm text-vx-fg-muted">{t("app.editor.credits.expiry")}</p>
            </div>
            <Link
              href="/app/credits#credit-packs"
              className="text-sm font-black text-vx-accent underline underline-offset-4"
            >{t("app.editor.credits.open")}</Link>
          </div>

          {packs.length > 0 && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {packs.map((pack) => <PackCard key={pack.id} pack={pack} />)}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-vx-danger/50 bg-vx-danger/[0.08] p-3 text-sm text-vx-danger"
            >
              {error}{' '}
              <button type="button" className="font-black underline" onClick={load}>{t("app.account.mfa.retry")}</button>
            </div>
          )}

          <p className="mt-6 text-xs leading-5 text-vx-fg-muted">{t("app.editor.credits.policy")}{' '}
            <LegalLink element="Link" className="underline" href="/legal/refund">{t("app.credits.packs.refund")}</LegalLink>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
