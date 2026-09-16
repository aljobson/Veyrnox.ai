// Metadata for the Library route — the page itself is a client component,
// so it cannot export it.
export const metadata = {
  title: 'Library',
  description:
    'Every generation you have run — successes, failures and the refunds that followed.',
  alternates: { canonical: '/app/library' },
  openGraph: { title: 'Library — Veyrnox.ai', description: 'Every generation you have run — successes, failures and the refunds that followed.', url: '/app/library' },
};

export default function Layout({ children }) {
  return children;
}
