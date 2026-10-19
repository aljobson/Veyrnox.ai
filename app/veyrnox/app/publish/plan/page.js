import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../../lib/i18n/server';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import PublishPlanPanel from './PublishPlanPanel';

export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.publishPlan.title', 'Publish plans and billing');
  const description = tOr(t, 'app.meta.publishPlan.description', 'Manage your Veyrnox.ai Publish plan and billing.');
  return {
    title,
    description,
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
