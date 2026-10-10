import { notFound } from 'next/navigation';

export const metadata = {
  title: 'Projects',
  description: 'Manage projects in your workspace.',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default function Layout({ children }) {
  if (process.env.TENANT_PROJECTS_ENABLED !== 'true') notFound();
  return children;
}
