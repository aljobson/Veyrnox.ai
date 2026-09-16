// Metadata for the Presets route — the page itself is a client component,
// so it cannot export it.
export const metadata = {
  title: 'Presets',
  description:
    'Curated one-tap looks pinned to their best-fit model, each showing its credit cost before you generate. Browse free, no card.',
  alternates: { canonical: '/presets' },
  openGraph: { title: 'Presets — Veyrnox.ai', description: 'Curated one-tap looks pinned to their best-fit model, each showing its credit cost before you generate. Browse free, no card.', url: '/presets' },
};

export default function Layout({ children }) {
  return children;
}
