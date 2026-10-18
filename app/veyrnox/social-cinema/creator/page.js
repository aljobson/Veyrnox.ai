import { localizedHref } from '../../../../lib/i18n/locales.mjs';
import { OPEN_GRAPH_BASE } from '../../../seo';
import { pageAlternates, openGraphLocale } from '../../../../lib/i18n/metadata.mjs';
import { getT } from '../../../../lib/i18n/server';
import Link from 'next/link';
import { cinemaFeatures } from '../../../../lib/cinema/features';
import { AccountBoundary } from '../../_components/AccountBoundary';
import { CreatorWorkspace } from './CreatorWorkspace';
import { Main } from '../../_components/Main';
export async function generateMetadata() {
  const { locale, t } = await getT();
  const alternates = pageAlternates(locale, '/social-cinema/creator');
  const title = t("cinema.page.creatorWorkspaceVeyrnoxCinema");
  return { title, alternates, robots: { index: false }, openGraph: { ...OPEN_GRAPH_BASE, title, url: alternates.canonical, ...openGraphLocale(locale) } };
}
export const dynamic = 'force-dynamic';
export default async function CreatorPage() {
  const { locale, t } = await getT();
  return <Main className="mx-auto max-w-[1100px] px-4 py-10 pb-40 sm:px-8">
    <Link href={localizedHref(locale, "/social-cinema")} className="text-sm text-vx-accent hover:underline">{t('cinema.creator.back')}</Link>
    <h1 className="mt-6 text-3xl font-black sm:text-4xl">{t("cinema.page.creatorWorkspace")}</h1>
    <p className="mt-4 max-w-2xl text-vx-fg-body">{t("cinema.page.developYourFilmsAndSeriesManage")}</p>
    <AccountBoundary><CreatorWorkspace proxyUploadsEnabled={process.env.CINEMA_PROXY_UPLOADS_ENABLED === 'true'} analyticsEnabled={cinemaFeatures(process.env).creatorAnalytics} /></AccountBoundary>
  </Main>;
}
