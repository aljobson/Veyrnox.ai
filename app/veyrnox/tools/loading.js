import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';

const PLACEHOLDERS = ['Image tools', 'Video tools', 'Audio tools'];

export default function LoadingTools() {
  return (
    <div className="min-h-dvh" aria-busy="true" aria-live="polite">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <p className="font-vx-mono text-sm font-bold uppercase tracking-[0.14em] text-vx-fg-muted">Tools</p>
        <h1 className="vx-display vx-title-index mt-3 max-w-[12ch]">Loading tools…</h1>
        <p className="mt-6 mb-12 text-lg sm:text-xl text-vx-fg-body max-w-[46ch] leading-[1.5] text-pretty">
          Getting current models and credit prices.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-12 gap-y-12" aria-hidden="true">
          {PLACEHOLDERS.map((label) => (
            <div key={label} className="animate-pulse">
              <div className="border-b-2 border-vx-fg pb-2">
                <div className="h-6 w-32 rounded bg-vx-border" />
                <div className="mt-2 h-4 w-48 max-w-full rounded bg-vx-border" />
              </div>
              <div className="mt-4 space-y-5">
                <div className="h-5 rounded bg-vx-border" />
                <div className="h-5 rounded bg-vx-border" />
                <div className="h-5 rounded bg-vx-border" />
              </div>
            </div>
          ))}
        </div>
      </Main>
    </div>
  );
}
