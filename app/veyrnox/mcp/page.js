import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { CopyButton } from '../_components/CopyButton';
import { Main } from '../_components/Main';
import { OPEN_GRAPH_BASE } from '../../seo';
import { getT } from '../../../lib/i18n/server';
import { pageAlternates, openGraphLocale } from '../../../lib/i18n/metadata.mjs';
import { rich } from '../../../lib/i18n/rich';

const ENDPOINT = 'https://veyrnox.ai/api/v1/mcp';
export async function generateMetadata() {
  const { locale, t } = await getT();
  const alternates = pageAlternates(locale, '/mcp');
  const description = t('mcp.meta.description');
  return {
    title: t('mcp.meta.title'),
    description,
    alternates,
    openGraph: { ...OPEN_GRAPH_BASE, title: t('mcp.meta.ogTitle'), description, url: alternates.canonical, ...openGraphLocale(locale) },
  };
}

// Tool names are the connector's own identifiers; each has a description key mcp.tool.<name>.
const tools = ['list_models', 'estimate_generation', 'generate_image', 'get_generation', 'list_generations', 'get_balance'];

export default async function McpPage() {
  const { t } = await getT();
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-24">
        <div className="grid lg:grid-cols-[1.15fr_.85fr] gap-14 lg:gap-20 items-start">
          <div>
            <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">{t('mcp.kicker')}</p>
            <h1 className="vx-display vx-title-index mt-5 max-w-[11ch] leading-[.92]">
              {t('mcp.title')}
            </h1>
            <p className="mt-7 text-lg sm:text-xl text-vx-fg-body max-w-[50ch] leading-[1.55] text-pretty">
              {t('mcp.lead')}
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/app/credits" className="vx-press rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover">
                {t('mcp.credits')}
              </Link>
              <Link href="/models" className="vx-press rounded-full border border-vx-border px-6 py-3 text-sm font-extrabold text-vx-fg-body hover:border-vx-fg">
                {t('common.browseModels')}
              </Link>
            </div>
          </div>

          <aside className="rounded-[28px] border border-vx-border bg-vx-panel p-5 sm:p-7" aria-labelledby="connect-heading">
            <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] uppercase text-vx-fg-muted">{t('mcp.endpoint')}</p>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-vx-border bg-vx-base px-4 py-3">
              <code className="min-w-0 overflow-x-auto whitespace-nowrap font-vx-mono text-[12px] text-vx-fg-body">{ENDPOINT}</code>
              <CopyButton value={ENDPOINT} label={t('common.copy')} copiedLabel={t('common.copied')} className="shrink-0" />
            </div>
            <h2 id="connect-heading" className="mt-8 text-2xl font-black">{t('mcp.connect')}</h2>
            <ol className="mt-5 space-y-5">
              {[
                ['01', t('mcp.s1.title'), t('mcp.s1.body')],
                ['02', t('mcp.s2.title'), t('mcp.s2.body')],
                ['03', t('mcp.s3.title'), t('mcp.s3.body')],
              ].map(([number, title, body]) => (
                <li key={number} className="grid grid-cols-[36px_1fr] gap-3">
                  <span className="font-vx-mono text-[12px] font-bold text-vx-accent pt-1">{number}</span>
                  <div><h3 className="font-extrabold">{title}</h3><p className="mt-1 text-sm leading-[1.55] text-vx-fg-muted">{body}</p></div>
                </li>
              ))}
            </ol>
            <p className="mt-7 border-t border-vx-border pt-5 text-[13px] leading-[1.55] text-vx-fg-muted">
              {t('mcp.noKey')}
            </p>
          </aside>
        </div>

        <section className="mt-24 sm:mt-32" aria-labelledby="tools-heading">
          <div className="max-w-[720px]">
            <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">{t('mcp.what.kicker')}</p>
            <h2 id="tools-heading" className="vx-display mt-4 text-[40px] sm:text-[58px]">{t('mcp.what.title')}</h2>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">{t('mcp.what.p')}</p>
          </div>
          <ul className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 border-t border-vx-border">
            {tools.map((name) => (
              <li key={name} className="border-b border-vx-border py-6 md:pr-8">
                <code className="font-vx-mono text-[13px] font-bold text-vx-money">{name}</code>
                <p className="mt-2 text-[15px] leading-[1.55] text-vx-fg-body">{t(`mcp.tool.${name}`)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-24 rounded-[32px] border border-vx-border p-7 sm:p-10 lg:p-14 grid lg:grid-cols-2 gap-10" aria-labelledby="spend-heading">
          <div>
            <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">{t('mcp.safe.kicker')}</p>
            <h2 id="spend-heading" className="vx-display mt-4 text-[40px] sm:text-[56px]">{t('mcp.safe.title')}</h2>
          </div>
          <div className="space-y-4 text-vx-fg-body leading-[1.65]">
            <p>{t('mcp.safe.p1')}</p>
            <p>{t('mcp.safe.p2')}</p>
            <p className="text-sm text-vx-fg-muted">{t('mcp.safe.p3')}</p>
          </div>
        </section>
      </Main>
    </div>
  );
}
