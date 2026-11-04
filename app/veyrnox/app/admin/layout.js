import EnvironmentBanner from '../../../../components/EnvironmentBanner';

// Metadata for the Admin route — the page itself is a client component,
// so it cannot export it.
export const metadata = {
  title: 'Admin',
  description:
    'Internal metrics.',
  robots: { index: false, follow: false },
};

// The banner reads APP_ENV per request (never prerendered).
export const dynamic = 'force-dynamic';

export default function Layout({ children }) {
  return (
    <>
      <EnvironmentBanner />
      {children}
    </>
  );
}
