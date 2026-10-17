import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { CopyButton } from '../_components/CopyButton';
import { Main } from '../_components/Main';
import { getT } from '../../../lib/i18n/server';
import { pageAlternates, openGraphLocale } from '../../../lib/i18n/metadata.mjs';
import { rich } from '../../../lib/i18n/rich';

const API = 'https://veyrnox.ai/api/v1/developer';
const OAUTH_METADATA = 'https://veyrnox.ai/.well-known/oauth-protected-resource/api/v1/developer';
const INSTALL = 'pipx install "git+https://github.com/aljobson/Veyrnox.ai.git#subdirectory=agent-harness"';
export async function generateMetadata() {
  const { locale, t } = await getT();
  const alternates = pageAlternates(locale, '/developers');
  const description = t('dev.meta.description');
  return {
    title: t('dev.meta.title'), description,
    alternates,
    openGraph: { title: t('dev.meta.ogTitle'), description, url: alternates.canonical, ...openGraphLocale(locale) },
  };
}

// [method, path, catalog key of its description]
const endpoints = [
  ['GET', '/models', 'dev.ep.models'],
  ['POST', '/estimates', 'dev.ep.estimates'],
  ['POST', '/generations', 'dev.ep.generations'],
  ['GET', '/generations/{id}', 'dev.ep.poll'],
  ['GET', '/generations/{id}/asset', 'dev.ep.asset'],
  ['GET', '/balance', 'dev.ep.balance'],
];

const CODE = (text) => <code className="font-vx-mono text-[13px]">{text}</code>;

export default async function DevelopersPage() {
  const { t } = await getT();
  return <div className="min-h-dvh">
    <MarketingNav />
    <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-24">
      <div className="grid lg:grid-cols-[1.08fr_.92fr] gap-14 lg:gap-20 items-start">
        <div>
          <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">{t('dev.kicker')}</p>
          <h1 className="vx-display vx-title-index mt-5 max-w-[10ch] leading-[.92]">{t('dev.title')}</h1>
          <p className="mt-7 text-lg sm:text-xl text-vx-fg-body max-w-[52ch] leading-[1.55] text-pretty">
            {t('dev.lead')}
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/api/developer/openapi" className="vx-press rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover">{t('dev.openapi')}</Link>
            <Link href="/models" className="vx-press rounded-full border border-vx-border px-6 py-3 text-sm font-extrabold text-vx-fg-body hover:border-vx-fg">{t('common.browseModels')}</Link>
          </div>
        </div>
        <aside className="rounded-[28px] border border-vx-border bg-vx-panel p-5 sm:p-7" aria-labelledby="install-heading">
          <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] uppercase text-vx-fg-muted">{t('dev.cli.kicker')}</p>
          <h2 id="install-heading" className="mt-3 text-2xl font-black">{t('dev.cli.title')}</h2>
          {[INSTALL, 'veyrnox auth login', 'veyrnox models list', 'veyrnox generations create --model nano-banana-kie --prompt "A blue fox"'].map((value) =>
            <div key={value} className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-vx-border bg-vx-base px-4 py-3">
              <code className="min-w-0 overflow-x-auto whitespace-nowrap font-vx-mono text-[12px] text-vx-fg-body">{value}</code>
              <CopyButton value={value} label={t('common.copy')} copiedLabel={t('common.copied')} className="shrink-0" />
            </div>)}
          <p className="mt-5 text-[13px] leading-[1.55] text-vx-fg-muted">{t('dev.cli.note')}</p>
        </aside>
      </div>

      <section className="mt-24 sm:mt-32" aria-labelledby="api-heading">
        <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">{t('dev.api.kicker')}</p>
        <h2 id="api-heading" className="vx-display mt-4 text-[40px] sm:text-[58px]">{t('dev.api.title')}</h2>
        <div className="mt-7 flex items-center justify-between gap-3 rounded-2xl border border-vx-border bg-vx-panel px-4 py-3 max-w-3xl">
          <code className="min-w-0 overflow-x-auto whitespace-nowrap font-vx-mono text-[12px] text-vx-fg-body">{API}</code>
          <CopyButton value={API} label={t('common.copy')} copiedLabel={t('common.copied')} className="shrink-0" />
        </div>
        <ul className="mt-10 grid md:grid-cols-2 border-t border-vx-border">
          {endpoints.map(([method, path, key]) => <li key={path} className="border-b border-vx-border py-6 md:pr-8">
            <p><span className="font-vx-mono text-[12px] font-bold text-vx-money">{method}</span> <code className="ml-2 font-vx-mono text-[13px] font-bold">{path}</code></p>
            <p className="mt-2 text-[15px] leading-[1.55] text-vx-fg-body">{t(key)}</p>
          </li>)}
        </ul>
      </section>

      <section className="mt-24 sm:mt-32 grid lg:grid-cols-[.85fr_1.15fr] gap-10 lg:gap-20" aria-labelledby="oauth-heading">
        <div>
          <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">OAuth 2.1 + PKCE</p>
          <h2 id="oauth-heading" className="vx-display mt-4 text-[40px] sm:text-[56px]">{t('dev.oauth.title')}</h2>
        </div>
        <div>
          <p className="text-vx-fg-body leading-[1.65]">{t('dev.oauth.p')}</p>
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-vx-border bg-vx-panel px-4 py-3">
            <code className="min-w-0 overflow-x-auto whitespace-nowrap font-vx-mono text-[12px] text-vx-fg-body">{OAUTH_METADATA}</code>
            <CopyButton value={OAUTH_METADATA} label={t('common.copy')} copiedLabel={t('common.copied')} className="shrink-0" />
          </div>
          <ol className="mt-7 space-y-4 text-[15px] leading-[1.6] text-vx-fg-body">
            <li><strong className="text-vx-fg">{t('dev.oauth.s1.head')}</strong> {rich(t('dev.oauth.s1.body'), { code: CODE('token_endpoint_auth_method: none') })}</li>
            <li><strong className="text-vx-fg">{t('dev.oauth.s2.head')}</strong> {t('dev.oauth.s2.body')}</li>
            <li><strong className="text-vx-fg">{t('dev.oauth.s3.head')}</strong> {rich(t('dev.oauth.s3.body'), { code: CODE('Authorization: Bearer …') })}</li>
          </ol>
        </div>
      </section>

      <section className="mt-24 rounded-[32px] border border-vx-border p-7 sm:p-10 lg:p-14 grid lg:grid-cols-2 gap-10" aria-labelledby="safety-heading">
        <div><p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">{t('dev.safety.kicker')}</p>
          <h2 id="safety-heading" className="vx-display mt-4 text-[40px] sm:text-[56px]">{t('dev.safety.title')}</h2></div>
        <div className="space-y-4 text-vx-fg-body leading-[1.65]">
          <p>{rich(t('dev.safety.p1'), { code: CODE('confirmed_credits') })}</p>
          <p>{t('dev.safety.p2')}</p>
          <p className="text-sm text-vx-fg-muted">{t('dev.safety.p3')}</p>
        </div>
      </section>
    </Main>
  </div>;
}
