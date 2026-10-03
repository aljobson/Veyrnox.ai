import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { GUIDES } from '../_lib/guides';

const DESCRIPTION = 'Short guides to generating, templates, working on your own files, the Library and credits on Veyrnox.';
export const metadata = {
  title: 'Guides',
  description: DESCRIPTION,
  alternates: { canonical: '/guides' },
  openGraph: { title: 'Guides — Veyrnox.ai', description: DESCRIPTION, url: '/guides' },
};

export default function Guides() {
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <section className="max-w-[900px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <h1 className="vx-display text-[52px] sm:text-[80px] leading-[0.95]">Guides</h1>
        <p className="mt-6 mb-10 text-lg text-vx-fg-body max-w-[46ch] leading-[1.5]">Short, step-by-step answers to the things people do first.</p>
        <ul className="border-t border-vx-border">
          {GUIDES.map((g) => (
            <li key={g.id} className="border-b border-vx-border">
              <Link href={`/guides/${g.id}`} className="group block py-5">
                <span className="block text-xl font-black group-hover:underline underline-offset-4">{g.title}</span>
                <span className="mt-1 block text-[15px] text-vx-fg-muted">{g.summary} {g.steps.length} steps.</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
