// Metadata for the Pricing route — the page itself is a client component,
// so it cannot export it.
export const metadata = {
  title: 'Pricing',
  description:
    'Every model on the Veyrnox catalog with its exact credit price. One balance, no tiers, no add-ons — and 50 free credits on sign-up.',
  alternates: { canonical: '/pricing' },
  openGraph: { title: 'Pricing — Veyrnox.ai', description: 'Every model on the Veyrnox catalog with its exact credit price. One balance, no tiers, no add-ons — and 50 free credits on sign-up.', url: '/pricing' },
};

export default function Layout({ children }) {
  return children;
}
