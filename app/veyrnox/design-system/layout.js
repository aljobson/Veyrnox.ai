// Metadata for the Design system route — the page itself is a client component,
// so it cannot export it.
export const metadata = {
  title: 'Design system',
  description:
    'Colour tokens, type scale and component reference for the Veyrnox.ai interface.',
  alternates: { canonical: '/design-system' },
  openGraph: { title: 'Design system — Veyrnox.ai', description: 'Colour tokens, type scale and component reference for the Veyrnox.ai interface.', url: '/design-system' },
  robots: { index: false, follow: false },
};

export default function Layout({ children }) {
  return children;
}
