import Link from 'next/link';
import { localizedHref } from '../../../lib/i18n/locales.mjs';
import { translator } from '../../../lib/i18n/translate.mjs';

const ACTION = 'vx-press inline-flex items-center justify-center rounded-full border px-3 py-1.5 font-vx-mono text-[10px] font-bold transition-colors';
const ACTION_PRIMARY = `${ACTION} border-vx-accent bg-vx-accent/[0.09] text-vx-accent hover:bg-vx-accent/20`;
const ACTION_QUIET = `${ACTION} border-vx-border bg-vx-base text-vx-fg-muted hover:border-vx-fg/30 hover:text-vx-fg`;

// One cast member in the gallery. The character's name is the card's link
// (stretched over the whole card), and Recreate and Animate sit above it, so
// no link is nested inside another.
export function OddlingCard({ oddling, eager = false, locale = 'en', t = translator('en') }) {
  // The character arrives already in the page's language (localizeOddling).
  const path = localizedHref(locale, oddling.path);
  return (
    <li className="group relative overflow-hidden rounded-2xl border border-vx-border bg-vx-panel transition-colors hover:border-vx-accent focus-within:border-vx-accent">
      <img
        src={oddling.portrait.src}
        alt={oddling.portrait.alt}
        width={oddling.portrait.width}
        height={oddling.portrait.height}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className="aspect-[2/3] w-full bg-vx-base object-contain"
      />
      <div className="p-4">
        <span className="font-vx-mono text-[8px] font-bold tracking-[0.14em] text-vx-accent">{oddling.accent}</span>
        <h3 className="mt-1 text-lg font-extrabold">
          <Link href={path} className="underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:underline">
            {oddling.name}
          </Link>
        </h3>
        <p className="mt-1 min-h-10 text-xs leading-relaxed text-vx-fg-muted">{oddling.hook}</p>
        <p className="mt-2 font-vx-mono text-[10px] font-bold uppercase tracking-[0.1em] text-vx-fg-faint">{oddling.kindLabel}</p>
        <div className="relative z-10 mt-4 grid grid-cols-2 gap-2">
          <Link href={oddling.studioHref} aria-label={t('oddlings.recreateAria', { name: oddling.name })} className={ACTION_PRIMARY}>{t('oddlings.recreate')}</Link>
          <Link href={oddling.studioHref} aria-label={t('oddlings.animateAria', { name: oddling.name })} className={ACTION_QUIET}>{t('oddlings.animate')}</Link>
        </div>
      </div>
    </li>
  );
}
