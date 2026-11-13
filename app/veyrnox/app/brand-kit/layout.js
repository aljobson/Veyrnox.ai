import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
import { notFound } from 'next/navigation';

export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.editor.rail.brand', 'Brand kit');
  return { title, robots: { index: false, follow: false } };
}
export const dynamic = 'force-dynamic';

// The Brand kit lives in a project workspace, so it shares the Projects switch.
export default function Layout({ children }) {
  if (process.env.TENANT_PROJECTS_ENABLED !== 'true') notFound();
  return children;
}
