import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { listModelsForDetails } from '../_lib/modelPages';
import { toolGroups, toolNeeds } from '../_lib/tools';
import { OPEN_GRAPH_BASE } from '../../seo';
import { getT } from '../../../lib/i18n/server';
import { pageAlternates, openGraphLocale } from '../../../lib/i18n/metadata.mjs';
import { rich } from '../../../lib/i18n/rich';

// Per request, like /models: the catalog needs the Worker's service-role key
// and is cached for 5 minutes in lib/publicCatalog.
export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const { locale, t } = await getT();
  const alternates = pageAlternates(locale, '/tools');
  const description = t('tools.meta.description');
  return {
    title: t('tools.meta.title'),
    description,
    alternates,
    openGraph: { ...OPEN_GRAPH_BASE, title: t('tools.meta.ogTitle'), description, url: alternates.canonical, ...openGraphLocale(locale) },
  };
}

export default async function Tools() {
  const { t } = await getT();
  // A task or group the catalog adds without a translation keeps its English words.
  const say = (key, fallback) => t.messages[key] ?? fallback;
  // The catalog being unreachable must leave a page, not a 500.
  let groups = [];
  try {
    groups = toolGroups(await listModelsForDetails());
  } catch (err) {
    console.error('[tools] catalog unavailable:', err && err.message);
  }

  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <h1 className="vx-display vx-title-index max-w-[12ch]">{t('tools.title')}</h1>
        <p className="mt-6 mb-12 text-lg sm:text-xl text-vx-fg-body max-w-[46ch] leading-[1.5] text-pretty">
          {t('tools.lead')}
        </p>
        {groups.length === 0 && (
          <p className="text-vx-fg-body">{rich(t('tools.empty'), { studio: <Link href="/app/create" className="font-bold underline underline-offset-4">{t('tools.studio')}</Link> })}</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-12 gap-y-12">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="border-b-2 border-vx-fg pb-2">
                <h2 className="text-xl font-black">{say(`tools.t.${g.key}.label`, g.label)}</h2>
                <p className="mt-1 text-[14px] text-vx-fg-muted">{say(`tools.t.${g.key}.blurb`, g.blurb)}</p>
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
                      <span>{t('tools.needs', { what: toolNeeds(m, t) })}</span>
                      <Link href={`/app/create?model=${encodeURIComponent(m.id)}`} className="shrink-0 font-bold text-vx-fg-body underline underline-offset-4 hover:text-vx-fg">{t('tools.use')}</Link>
                    </div>
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
