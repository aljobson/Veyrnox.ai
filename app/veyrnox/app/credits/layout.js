// Metadata for the Credits & billing route — the page itself is a client component,
// so it cannot export it.
export const metadata = {
  title: 'Credits & billing',
  description:
    'Your credit balance, free-credit expiry and the ledger rows behind it.',
  alternates: { canonical: '/app/credits' },
  openGraph: { title: 'Credits & billing — Veyrnox.ai', description: 'Your credit balance, free-credit expiry and the ledger rows behind it.', url: '/app/credits' },
};

export default function Layout({ children }) {
  return children;
}
