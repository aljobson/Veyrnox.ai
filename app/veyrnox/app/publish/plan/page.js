import { getT } from '../../../../../lib/i18n/server';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import PublishPlanPanel from './PublishPlanPanel';

export async function generateMetadata() {
  const { t } = await getT();
  return {
  title: t('app.publish.plan.pageTitle'),
  description: t('app.publish.plan.pageDescription'),
  robots: { index: false },
};
}

export default async function PublishPlanPage() {
  const { t } = await getT();
  return <><AppNav /><Main className="mx-auto max-w-[900px] px-4 py-10 sm:px-8">
    <h1 className="text-3xl font-black">{t('app.publish.plan.heading')}</h1>
    <p className="mb-6 mt-2 text-sm text-vx-fg-muted">{t('app.publish.plan.intro')}</p>
    <PublishPlanPanel />
  </Main></>;
}
