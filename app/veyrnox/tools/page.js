import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { listModels } from '../_lib/modelPages';
import { toolGroups, toolNeeds } from '../_lib/tools';

// Per request, like /models: the catalog needs the Worker's service-role key
// and is cached for 5 minutes in lib/publicCatalog.
export const dynamic = 'force-dynamic';

const DESCRIPTION = 'Upscale, cut out, expand, edit and animate your own images and video. Each tool shows its exact credit price.';
export const metadata = {
  title: 'Tools',
  description: DESCRIPTION,
  alternates: { canonical: '/tools' },
  openGraph: { title: 'Tools — Veyrnox.ai', description: DESCRIPTION, url: '/tools' },
};

export default async function Tools() {
  // The catalog being unreachable must leave a page, not a 500.
  let groups = [];
  try {
    groups = toolGroups(await listModels());
  } catch (err) {
    console.error('[tools] catalog unavailable:', err && err.message);
  }

  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <section className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <h1 className="vx-display vx-title-index max-w-[12ch]">Bring your own file.</h1>
        <p className="mt-6 mb-12 text-lg sm:text-xl text-vx-fg-body max-w-[46ch] leading-[1.5] text-pretty">
          Tools that start from an image or video you already have. The price is on each one, and nothing is charged until you generate.
        </p>
        {groups.length === 0 && (
          <p className="text-vx-fg-body">The tool list is unavailable right now. <Link href="/app/create" className="font-bold underline underline-offset-4">Open the studio</Link> to see every model.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-12 gap-y-12">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="border-b-2 border-vx-fg pb-2">
                <h2 className="text-xl font-black">{g.label}</h2>
                <p className="mt-1 text-[14px] text-vx-fg-muted">{g.blurb}</p>
              </div>
              <ul className="mt-2">
                {g.tools.map((m) => (
                  <li key={m.id} className="py-3 border-b border-vx-border">
                    <div className="flex items-baseline gap-2 font-vx-mono text-[14px] vx-num">
                      <Link href={`/models/${encodeURIComponent(m.id)}`} className="min-w-0 truncate text-vx-fg-body hover:text-vx-fg hover:underline underline-offset-4">{m.title}</Link>
                      <span aria-hidden className="vx-leader flex-1" />
                      <span className="shrink-0 font-bold text-vx-money">{m.credits} cr</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[13px] text-vx-fg-muted">
                      <span>Needs {toolNeeds(m)}</span>
                      <Link href={`/app/create?model=${encodeURIComponent(m.id)}`} className="shrink-0 font-bold text-vx-fg-body underline underline-offset-4 hover:text-vx-fg">Use it</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
