import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
import { notFound } from 'next/navigation';

export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.projects.title', 'Projects');
  const description = tOr(t, 'app.meta.projects.description', 'Manage projects in your workspace.');
  return {
    title,
    description,
    robots: { index: false, follow: false },
  };
}
export const dynamic = 'force-dynamic';

export default function Layout({ children }) {
  if (process.env.TENANT_PROJECTS_ENABLED !== 'true') notFound();
  return children;
}
