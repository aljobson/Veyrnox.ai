// Metadata for the Admin route — the page itself is a client component,
// so it cannot export it.
export const metadata = {
  title: 'Admin',
  description:
    'Internal metrics.',
  robots: { index: false, follow: false },
};

export default function Layout({ children }) {
  return children;
}
