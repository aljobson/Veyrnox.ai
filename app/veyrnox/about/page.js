import Link from 'next/link';
import { ENTITY } from '../../legal/_lib/entity';
import { OPEN_GRAPH_BASE } from '../../seo';
import { Main } from '../_components/Main';
import { MarketingNav } from '../_components/NavBar';

const DESCRIPTION = 'Company information for Veyrnox.ai, the credit-metered AI media generation service operated by Veyrnox Ltd.';

export const metadata = {
  title: 'About',
  description: DESCRIPTION,
  alternates: { canonical: '/about' },
  openGraph: { ...OPEN_GRAPH_BASE, title: 'About Veyrnox.ai', description: DESCRIPTION, url: '/about' },
};

export default function AboutPage() {
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <article className="max-w-[760px]">
          <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">Company</p>
          <h1 className="vx-display vx-title-index mt-5">About Veyrnox.ai</h1>
          <p className="mt-7 text-lg sm:text-xl text-vx-fg-body leading-[1.6]">
            Veyrnox.ai is a web application for credit-metered AI video, image and audio generation. It shows the credit price before a generation starts, and failed generation jobs refund automatically.
          </p>

          <section className="mt-16 border-t-2 border-vx-fg pt-6" aria-labelledby="company-details">
            <h2 id="company-details" className="text-2xl font-black">Company details</h2>
            <dl className="mt-6 border-t border-vx-border">
              <CompanyFact label="Legal name" value={ENTITY.name} />
              <CompanyFact label="Trading as" value={ENTITY.trading} />
              <CompanyFact label="Company number" value={ENTITY.companyNo} />
              <CompanyFact label="Registered in" value={ENTITY.jurisdiction} />
              <CompanyFact label="Registered office" value={ENTITY.office} />
            </dl>
          </section>

          <section className="mt-14" aria-labelledby="contact-details">
            <h2 id="contact-details" className="text-2xl font-black">Contact and policies</h2>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">
              For legal or general company enquiries, email{' '}
              <a className="font-bold underline underline-offset-4 hover:text-vx-accent" href={`mailto:${ENTITY.email}`}>{ENTITY.email}</a>.
            </p>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">
              Read the <Link className="font-bold underline underline-offset-4 hover:text-vx-accent" href="/legal/terms">Terms of Service</Link>,{' '}
              <Link className="font-bold underline underline-offset-4 hover:text-vx-accent" href="/legal/privacy">Privacy Policy</Link> and{' '}
              <Link className="font-bold underline underline-offset-4 hover:text-vx-accent" href="/legal/refund">Refund Policy</Link>.
            </p>
          </section>
        </article>
      </Main>
    </div>
  );
}

function CompanyFact({ label, value }) {
  return (
    <div className="grid gap-1 border-b border-vx-border py-4 sm:grid-cols-[180px_1fr] sm:gap-6">
      <dt className="text-[14px] text-vx-fg-muted">{label}</dt>
      <dd className="text-vx-fg-body">{value}</dd>
    </div>
  );
}
