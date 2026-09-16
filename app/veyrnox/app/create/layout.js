// Metadata for the Create route — the page itself is a client component,
// so it cannot export it.
export const metadata = {
  title: 'Create',
  description:
    'Pick a model, see the exact credit cost on the button, and generate. Failed jobs refund automatically.',
  alternates: { canonical: '/app/create' },
  openGraph: { title: 'Create — Veyrnox.ai', description: 'Pick a model, see the exact credit cost on the button, and generate. Failed jobs refund automatically.', url: '/app/create' },
};

export default function Layout({ children }) {
  return children;
}
