'use client';
import { useI18n } from '../../../components/I18nProvider';

import { AppNav } from './NavBar';
import { Main } from './Main';

const BAR = 'vx-shimmer bg-vx-panel';
// The real title, sentence and chips at about their widths, in rows that wrap the way
// theirs do, so the placeholder is as tall as the header will be at any screen width.
const STATE_PILLS = ['w-16', 'w-28', 'w-26', 'w-24', 'w-20'];
const KIND_PILLS = ['w-24', 'w-23', 'w-20', 'w-20', 'w-34'];
const VIEW_PILLS = ['w-18', 'w-16'];
const pills = (widths) => widths.map((width, i) => <div key={i} className={`${BAR} h-10 rounded-full ${width}`} />);

// One placeholder for every Library loading state: the route's loading.js, the
// page before it has read the session, and the page before it has read its
// history. `page` adds what sits above the grid (title, filters, the "On this
// device" block the page always opens with), so nothing moves when the real
// ones arrive. The nav above it is the real one in all three. `view` is the
// saved layout: a list is one narrow column on the page, so it is one here.
export function LibrarySkeleton({ page = false, view = 'grid' }) {
  const { t } = useI18n();
  const grid = (
    <div aria-hidden="true" className={view === 'list' ? 'grid grid-cols-1 gap-3 max-w-[760px]' : 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'}>
      {Array.from({ length: 6 }, (_, i) => <div key={i} className={`${BAR} h-64 rounded-2xl`} />)}
    </div>
  );
  if (!page) return grid;
  return (
    <>
      <section aria-hidden="true" className="max-w-[1400px] mx-auto px-4 sm:px-8 pt-10 pb-4">
        <div className="flex flex-wrap gap-x-3">
          <div className={`${BAR} h-9.5 w-64 rounded-xl sm:h-13 sm:w-96`} />
          <div className={`${BAR} h-9.5 w-50 rounded-xl sm:h-13 sm:w-66`} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-2">
          <div className={`${BAR} h-6 w-64 rounded-full`} />
          <div className={`${BAR} h-6 w-64 rounded-full`} />
        </div>
        <div className="mt-6 flex flex-wrap gap-2">{pills(STATE_PILLS)}</div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">{pills(KIND_PILLS)}</div>
          <div className="flex gap-2">{pills(VIEW_PILLS)}</div>
        </div>
      </section>
      <section aria-hidden="true" className="mx-auto max-w-[1400px] space-y-3 px-4 py-6 sm:px-8">
        <div className={`${BAR} h-7 w-40 rounded-full`} />
        <div className="flex flex-wrap gap-x-2">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className={`${BAR} h-5 w-76 rounded-full`} />)}
        </div>
        <div className={`${BAR} h-10 w-48 rounded-xl`} />
        <div className={`${BAR} h-5 w-64 rounded-full`} />
      </section>
      <section className="max-w-[1400px] mx-auto px-4 sm:px-8 pb-16">
        <p role="status" className="sr-only">{t("app.library.loading")}</p>
        {grid}
      </section>
    </>
  );
}

export function LibraryAccessState({ loading }) {
  const { t } = useI18n();
  return (
    <div className="min-h-dvh">
      <AppNav active="library" readAccount={false} />
      <Main className={loading ? undefined : 'max-w-[1400px] mx-auto px-4 sm:px-8 py-16'} aria-busy={loading || undefined}>
        {loading ? <LibrarySkeleton page /> : <>
          <h1 className="vx-display text-[36px] sm:text-[48px]">{t("app.library.signIn")}</h1>
          <p className="mt-4 text-vx-fg-body">{t("app.library.signInHelp")}</p>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}
            className="vx-press mt-6 rounded-full bg-vx-accent text-vx-accent-ink px-5 py-2.5 text-sm font-extrabold">
            {t("oauth.signIn")}</button>
        </>}
      </Main>
    </div>
  );
}
