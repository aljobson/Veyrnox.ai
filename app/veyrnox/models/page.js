import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { PremiumTag } from '../_components/PremiumTag';
import { LIST_GROUPS } from '../_sections/showcase';
import { listModels } from '../_lib/modelPages';

// Rendered per request: the catalog needs the service-role key, which only
// the Worker has, and the rows are cached for 5 minutes in lib/publicCatalog.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Models',
  description: 'Every AI image, video and audio model on Veyrnox, with its exact credit price, read live from the catalog.',
  alternates: { canonical: '/models' },
  openGraph: { title: 'Models — Veyrnox.ai', description: 'Every AI image, video and audio model on Veyrnox, with its exact credit price, read live from the catalog.', url: '/models' },
};

export default async function ModelsIndex() {
  const models = await listModels();
  const groups = LIST_GROUPS
    .map((g) => ({ ...g, rows: models.filter((m) => m.kind === g.kind) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <h1 className="vx-display vx-title-index max-w-[12ch]">Every model. Exact prices.</h1>
        <p className="mt-6 mb-12 text-lg sm:text-xl text-vx-fg-body max-w-[46ch] leading-[1.5] text-pretty">
          {models.length} models, at the credits the button will show. Read live from the catalog.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-12 gap-y-12">
          {groups.map((g) => (
            <div key={g.kind}>
              <div className="flex items-baseline justify-between gap-3 border-b-2 border-vx-fg pb-2">
                <h2 className="text-xl font-black">{g.label}</h2>
                <span className="text-[13px] text-vx-fg-muted">{g.unit}</span>
              </div>
              <ul className="mt-2 font-vx-mono text-[14px] vx-num">
                {g.rows.map((m) => (
                  <li key={m.id}>
                    <Link href={`/models/${encodeURIComponent(m.id)}`} className="group flex items-baseline gap-2 py-2 text-vx-fg-body hover:text-vx-fg">
                      <span className="min-w-0 truncate group-hover:underline underline-offset-4">{m.title}</span>
                      {m.gated && <PremiumTag className="shrink-0" />}
                      <span aria-hidden className="vx-leader flex-1" />
                      <span className="shrink-0 font-bold text-vx-money">{m.credits} cr</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Main>
    </div>
  );
}
