import { notFound } from 'next/navigation';
import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { OG_IMAGE, OPEN_GRAPH_BASE } from '../../seo';
import {
  ODDLINGS_PATH,
  groupPublicOddlings,
  listPublicOddlings,
  oddlingsIndexMetadata,
  oddlingsPublicEnabled,
} from '../_lib/oddlingsPublic';
import { OddlingCard } from './OddlingCard';
import { ShareLinkButton } from './ShareLinkButton';

// The flag is a Worker var, so it is read on every request. Closed (the
// default in production) the route answers not-found and the sitemap omits it.
export const dynamic = 'force-dynamic';

// Portraits above the fold load at once; the rest wait until they scroll near.
const EAGER_PORTRAITS = 4;

export function generateMetadata() {
  if (!oddlingsPublicEnabled()) return { title: 'Page not found', robots: { index: false } };
  const meta = oddlingsIndexMetadata(OG_IMAGE);
  return { ...meta, openGraph: { ...OPEN_GRAPH_BASE, ...meta.openGraph } };
}

export default function OddlingsGallery() {
  if (!oddlingsPublicEnabled()) notFound();
  const groups = groupPublicOddlings();
  const total = listPublicOddlings().length;
  const eagerIds = new Set(listPublicOddlings().slice(0, EAGER_PORTRAITS).map((o) => o.id));

  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <h1 className="vx-display vx-title-index max-w-[12ch]">Meet the Oddlings.</h1>
        <p className="mt-6 text-lg sm:text-xl text-vx-fg-body max-w-[46ch] leading-[1.5] text-pretty">
          {total} characters with a look, an obsession and a show of their own. Each is an original, fictional adult character, not a real person.
        </p>
        <p className="mt-4 mb-10 text-[15px] text-vx-fg-muted max-w-[52ch] leading-[1.5]">
          Browse free, with no sign-in. Recreate one as your own, or animate it in the studio. Nothing is charged until you press Generate.
        </p>
        <div className="mb-12">
          <ShareLinkButton
            path={ODDLINGS_PATH}
            title="Meet the Oddlings"
            label="Share link to this gallery"
            className="font-bold text-vx-fg-body underline underline-offset-4 hover:text-vx-fg"
          />
        </div>
        {groups.map((group) => (
          <section key={group.kind} aria-labelledby={`oddlings-${group.kind}`} className="mb-14">
            <div className="flex items-baseline justify-between gap-3 border-b-2 border-vx-fg pb-2">
              <h2 id={`oddlings-${group.kind}`} className="text-xl font-black">{group.heading}</h2>
              <span className="text-[13px] text-vx-fg-muted">{group.oddlings.length} characters</span>
            </div>
            <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {group.oddlings.map((oddling) => (
                <OddlingCard key={oddling.id} oddling={oddling} eager={eagerIds.has(oddling.id)} />
              ))}
            </ul>
          </section>
        ))}
      </Main>
    </div>
  );
}
